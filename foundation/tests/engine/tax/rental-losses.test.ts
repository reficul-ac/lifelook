import { describe, expect, it } from 'vitest';
import type { Cents } from '../../../src/engine/model/plan';
import type { HouseholdTaxState } from '../../../src/engine/model/tax-state';
import type { YearRules } from '../../../src/engine/rules/types';
import type { PreIraFacts } from '../../../src/engine/tax/facts';
import { buildPreIraFacts, passiveAllowanceMagi } from '../../../src/engine/tax/modified-income';
import { resolveRentalLosses, type RentalLossYear } from '../../../src/engine/tax/rental-losses';
import { loadReferences } from '../../helpers/references';
import { mustValidate } from '../../helpers/plans';
import { resolveCashYear } from '../../../src/engine/cash/income';
import { resolveWorkplaceContributions } from '../../../src/engine/tax/workplace';
import { buildPropertyFacts } from '../../../src/engine/property/facts';
import { initialTaxState } from '../../../src/engine/model/tax-state';
import { makePlan } from '../../helpers/plans';

interface RentalLossReferenceInput { readonly facts: PreIraFacts; readonly opening: HouseholdTaxState; readonly rules: YearRules; readonly passiveAllowanceMagiCents: Cents }
const references = loadReferences<RentalLossReferenceInput, RentalLossYear>('rental-losses-2026');
const sample = () => structuredClone(references[0]!.input);

describe('at-risk ordering and household passive rental losses', () => {
  it.each(references)('$id', c => { expect(resolveRentalLosses(c.input.facts, c.input.opening, c.input.rules)).toEqual(c.expected); });
  it.each([[10000000, -2500000, 600000], [12000000, -1500000, 1600000], [15000000, 0, 3100000]])('applies allowance at MAGI %i', (magi, allowed, suspended) => {
    const c = references.find(c => c.input.passiveAllowanceMagiCents === magi)!;
    const result = resolveRentalLosses(c.input.facts, c.input.opening, c.input.rules);
    if (result.federal.status !== 'available') throw new Error('missing rental book');
    expect(result.federal.value.allowedRentalCents).toBe(allowed);
    expect(result.federal.value.closingPassiveLossCents).toBe(suspended);
  });
  it('adds back IRA deductions while excluding all passive activity income from allowance MAGI', () => {
    const i = sample();
    const facts = { ...i.facts, nonRentalFederalAgiCents: { status: 'available' as const, value: 9250000 }, adjustments: { ...i.facts.adjustments, traditionalIraDeductionCents: 750000 } };
    expect(passiveAllowanceMagi(facts, i.rules)).toEqual({ status: 'available', value: 10000000 });
  });
  it('uses modified federal AGI for California despite a separate California non-rental adjustment', () => {
    const i = sample();
    const facts = { ...i.facts, nonRentalCaliforniaAgiCents: { status: 'available' as const, value: 20000000 } };
    const result = resolveRentalLosses(facts, i.opening, i.rules);
    if (result.california.status !== 'available') throw new Error('missing California');
    expect(result.california.value.allowedRentalCents).toBe(-2500000);
  });
  it('keeps unknown regular history unavailable in current and later years while independent AMT books stay available', () => {
    const i = sample();
    const missing = { status: 'needs-data' as const, issues: [{ code: 'required-history', recordId: 'rental-a', field: 'taxHistory.federal', severity: 'warning' as const, explanation: 'Unknown opening book', resolution: 'Supply it' }] };
    const opening = { ...i.opening, rentals: { ...i.opening.rentals, 'rental-a': { ...i.opening.rentals['rental-a']!, federal: missing } } };
    const first = resolveRentalLosses(i.facts, opening, i.rules);
    expect(first.federal.status).toBe('needs-data');
    expect(first.federal).not.toHaveProperty('value');
    expect(first.federalAmt.status).toBe('available');
    const second = resolveRentalLosses({ ...i.facts, year: 2027 }, first.closing, i.rules);
    expect(second.federal.status).toBe('needs-data');
    expect(second.federal).not.toHaveProperty('value');
  });
  it('blocks unsupported financing before claiming a current loss', () => {
    const i = sample();
    const facts = { ...i.facts, rentalFacts: i.facts.rentalFacts.map(r => ({ ...r, financingAtRiskQualification: { known: true as const, value: false } })) };
    expect(resolveRentalLosses(facts, i.opening, i.rules).federal.status).toBe('unsupported-case');
  });
  it('allocates one household allowance by stable rental ID without input mutation', () => {
    const i = structuredClone(references.find(c => c.id === 'shared-household-allowance')!.input);
    const facts = { ...i.facts, rentalFacts: [...i.facts.rentalFacts].reverse() };
    const before = JSON.stringify(facts);
    const result = resolveRentalLosses(facts, i.opening, i.rules);
    expect(result).toEqual(references.find(c => c.id === 'shared-household-allowance')!.expected);
    expect(JSON.stringify(facts)).toBe(before);
  });
  it('preserves independent AMT and QBI loss histories across the first and second year', () => {
    const i = sample();
    const qbi = { known: true as const, value: [{ year: 2024, amountCents: 12345 }] };
    const opening = { ...i.opening, qbiLossVintages: { 'rental-a': qbi } };
    const first = resolveRentalLosses(i.facts, opening, i.rules);
    expect(first.closing.qbiLossVintages['rental-a']).toEqual(qbi);
    if (first.federal.status !== 'available' || first.federalAmt.status !== 'available') throw new Error('missing books');
    expect(first.federal.value.rentals[0]?.closingState).not.toBe(first.federalAmt.value.rentals[0]?.closingState);
    expect(first.federal.value.rentals[0]?.closingState.lossVintages).toEqual([{ year: 2026, source: 'passive', amountCents: 600000, activeParticipation: { known: true, value: true }, qbiQualification: { known: true, value: false } }]);
  });
  it('keeps different QBI origin qualifications separate when releasing a shared-year loss pool', () => {
    const i = sample();
    const original = i.opening.rentals['rental-a']!.federal;
    if (original.status !== 'available') throw new Error('missing history');
    const carried = { ...original, value: { ...original.value, passiveSuspendedCents: 2000000, lossVintages: [{ year: 2024, source: 'passive' as const, amountCents: 1000000, activeParticipation: { known: true as const, value: true }, qbiQualification: { known: true as const, value: true } }, { year: 2024, source: 'passive' as const, amountCents: 1000000, activeParticipation: { known: true as const, value: true }, qbiQualification: { known: true as const, value: false } }] } };
    const opening = { ...i.opening, rentals: { ...i.opening.rentals, 'rental-a': { ...i.opening.rentals['rental-a']!, federal: carried } } };
    const facts = { ...i.facts, rentalFacts: i.facts.rentalFacts.map(r => ({ ...r, books: { ...r.books, federal: r.books.federal.status === 'available' ? { status: 'available' as const, value: { ...r.books.federal.value, taxableProfitCents: 0 } } : r.books.federal } })) };
    const result = resolveRentalLosses(facts, opening, i.rules);
    if (result.federal.status !== 'available') throw new Error('missing federal');
    expect(result.federal.value.rentals[0]?.releasedLossVintages).toHaveLength(2);
    expect(result.federal.value.rentals[0]?.releasedLossVintages.map(v => v.qbiQualification)).toEqual([{ known: true, value: true }, { known: true, value: false }]);
  });
  it('releases carryforward losses against another property’s passive profit before sharing the allowance', () => {
    const i = structuredClone(references.find(c => c.id === 'shared-household-allowance')!.input);
    const profitRental = { ...i.facts.rentalFacts[0]!, rentalId: 'rental-c', propertyId: 'property-c', unit: { ...i.facts.rentalFacts[0]!.unit, id: 'rental-c', propertyId: 'property-c' }, books: Object.fromEntries(Object.entries(i.facts.rentalFacts[0]!.books).map(([book, value]) => [book, value.status === 'available' ? { status: 'available', value: { ...value.value, rentalId: 'rental-c', taxableProfitCents: 500000 } } : value])) as typeof i.facts.rentalFacts[0]['books'] };
    const facts = { ...i.facts, rentalFacts: [...i.facts.rentalFacts, profitRental] };
    const opening = { ...i.opening, rentals: { ...i.opening.rentals, 'rental-c': i.opening.rentals['rental-a']! } };
    const result = resolveRentalLosses(facts, opening, i.rules);
    if (result.federal.status !== 'available') throw new Error('missing federal');
    expect(result.federal.value.allowedRentalCents).toBe(-1500000);
    expect(result.federal.value.closingPassiveLossCents).toBe(2000000);
  });
  it('requires missing loss-origin participation only when a special allowance could release it', () => {
    const i = structuredClone(references.find(c => c.id === 'year-two-release-against-passive-profit')!.input);
    const state = i.opening.rentals['rental-a']!.federal;
    if (state.status !== 'available') throw new Error('missing history');
    const unknownOrigin = { ...state, value: { ...state.value, lossVintages: state.value.lossVintages.map(({ activeParticipation: _origin, ...v }) => v) } };
    const opening = { ...i.opening, rentals: { ...i.opening.rentals, 'rental-a': { ...i.opening.rentals['rental-a']!, federal: unknownOrigin } } };
    expect(resolveRentalLosses(i.facts, opening, i.rules).federal.status).toBe('available');
    const facts = { ...i.facts, nonRentalFederalAgiCents: { status: 'available' as const, value: 10000000 } };
    const result = resolveRentalLosses(facts, opening, i.rules);
    expect(result.federal.status).toBe('needs-data');
    expect(result.federal).not.toHaveProperty('value');
  });
  it('retains inactive-origin losses when only the active-origin portion can use the allowance', () => {
    const i = sample();
    const original = i.opening.rentals['rental-a']!.federal;
    if (original.status !== 'available') throw new Error('missing history');
    const carried = { ...original, value: { ...original.value, passiveSuspendedCents: 2000000, lossVintages: [{ year: 2024, source: 'passive' as const, amountCents: 2000000, activeParticipation: { known: true as const, value: false } }] } };
    const opening = { ...i.opening, rentals: { ...i.opening.rentals, 'rental-a': { ...i.opening.rentals['rental-a']!, federal: carried } } };
    const result = resolveRentalLosses(i.facts, opening, i.rules);
    if (result.federal.status !== 'available') throw new Error('missing federal');
    expect(result.federal.value.allowedRentalCents).toBe(-2500000);
    expect(result.federal.value.rentals[0]?.closingState.lossVintages).toContainEqual({ year: 2024, source: 'passive', amountCents: 2000000, activeParticipation: { known: true, value: false } });
  });
  it('applies the active special allowance before residual passive-income allocation', () => {
    const i = structuredClone(references.find(c => c.id === 'shared-household-allowance')!.input);
    const active = i.facts.rentalFacts[1]!;
    const inactive = { ...i.facts.rentalFacts[0]!, unit: { ...i.facts.rentalFacts[0]!.unit, activeParticipation: { known: true as const, value: false } } };
    const profit = { ...active, rentalId: 'rental-c', unit: { ...active.unit, id: 'rental-c', activeParticipation: { known: true as const, value: false } }, books: Object.fromEntries(Object.entries(active.books).map(([book, value]) => [book, value.status === 'available' ? { status: 'available', value: { ...value.value, rentalId: 'rental-c', taxableProfitCents: 2000000 } } : value])) as typeof active.books };
    const facts = { ...i.facts, nonRentalFederalAgiCents: { status: 'available' as const, value: 10000000 }, rentalFacts: [inactive, active, profit] };
    const opening = { ...i.opening, rentals: { ...i.opening.rentals, 'rental-c': i.opening.rentals['rental-b']! } };
    const result = resolveRentalLosses(facts, opening, i.rules);
    if (result.federal.status !== 'available') throw new Error('missing federal');
    expect(result.federal.value.allowedRentalCents).toBe(-2000000);
    expect(result.federal.value.closingPassiveLossCents).toBe(0);
  });
  it('subtracts active rental profits before calculating the special-allowance loss pool', () => {
    const i = structuredClone(references.find(c => c.id === 'shared-household-allowance')!.input);
    const active = i.facts.rentalFacts[1]!;
    const inactive = { ...i.facts.rentalFacts[0]!, unit: { ...i.facts.rentalFacts[0]!.unit, activeParticipation: { known: true as const, value: false } } };
    const profit = { ...active, rentalId: 'rental-c', unit: { ...active.unit, id: 'rental-c' }, books: Object.fromEntries(Object.entries(active.books).map(([book, value]) => [book, value.status === 'available' ? { status: 'available', value: { ...value.value, rentalId: 'rental-c', taxableProfitCents: 2000000 } } : value])) as typeof active.books };
    const facts = { ...i.facts, nonRentalFederalAgiCents: { status: 'available' as const, value: 10000000 }, rentalFacts: [inactive, active, profit] };
    const opening = { ...i.opening, rentals: { ...i.opening.rentals, 'rental-c': i.opening.rentals['rental-b']! } };
    const result = resolveRentalLosses(facts, opening, i.rules);
    if (result.federal.status !== 'available') throw new Error('missing federal');
    expect(result.federal.value.allowedRentalCents).toBe(-1000000);
    expect(result.federal.value.closingPassiveLossCents).toBe(1000000);
  });
  it('requires active participation in the current year before releasing active-origin carryforwards through the allowance', () => {
    const i = structuredClone(references.find(c => c.id === 'year-two-release-against-passive-profit')!.input);
    const facts = { ...i.facts, nonRentalFederalAgiCents: { status: 'available' as const, value: 10000000 }, rentalFacts: i.facts.rentalFacts.map(r => ({ ...r, unit: { ...r.unit, activeParticipation: { known: true as const, value: false } } })) };
    const result = resolveRentalLosses(facts, i.opening, i.rules);
    if (result.federal.status !== 'available') throw new Error('missing federal');
    expect(result.federal.value.closingPassiveLossCents).toBe(100000);
  });
  it('builds explicit pre-IRA facts retaining a filer with no wages and untaxed cash', () => {
    const rules = sample().rules;
    const plan = mustValidate(makePlan({ otherIncome: [{ id: 'cash-gift', name: 'Gift', amountCents: 100, frequency: 'annual', startDate: '2026-01-01', annualGrowthBps: 0, classification: 'non-taxable' }] }));
    const cash = resolveCashYear(plan, 2026);
    const workplace = resolveWorkplaceContributions(plan, cash, [], rules);
    const property = buildPropertyFacts(plan, cash, [], initialTaxState(plan), rules);
    const facts = buildPreIraFacts(cash, workplace, property);
    expect(facts.filers).toHaveLength(2);
    expect(facts.nonTaxableCashCents).toBe(100);
    expect(facts.nonRentalFederalAgiCents).toEqual({ status: 'available', value: 0 });
  });
});
