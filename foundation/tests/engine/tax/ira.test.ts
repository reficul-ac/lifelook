import { describe, expect, it } from 'vitest';
import type { ContributionRequest } from '../../../src/engine/cash/contribution-requests';
import type { PlanDocument } from '../../../src/engine/model/plan';
import type { YearRules } from '../../../src/engine/rules/types';
import { buildResolvedTaxFacts, type IraYear, type PreIraFacts } from '../../../src/engine/tax/facts';
import { resolveIraContributions } from '../../../src/engine/tax/ira';
import { passiveAllowanceMagi, traditionalIraMagi, rothIraMagi } from '../../../src/engine/tax/modified-income';
import type { RentalLossYear } from '../../../src/engine/tax/rental-losses';
import type { WorkplaceYear } from '../../../src/engine/tax/workplace';
import { loadReferences } from '../../helpers/references';
import { mustValidate } from '../../helpers/plans';
import { makePlan } from '../../helpers/plans';
import { resolveCashYear } from '../../../src/engine/cash/income';
import { requestContributions } from '../../../src/engine/cash/contribution-requests';
import { resolveWorkplaceContributions } from '../../../src/engine/tax/workplace';
import { buildPropertyFacts } from '../../../src/engine/property/facts';
import { initialTaxState } from '../../../src/engine/model/tax-state';
import { buildPreIraFacts } from '../../../src/engine/tax/modified-income';
import { resolveRentalLosses } from '../../../src/engine/tax/rental-losses';

interface IraReferenceInput { readonly plan: PlanDocument; readonly facts: PreIraFacts; readonly rental: RentalLossYear; readonly requests: readonly ContributionRequest[]; readonly workplace: WorkplaceYear; readonly rules: YearRules }
const references = loadReferences<IraReferenceInput, IraYear>('ira-2026');
const sample = () => structuredClone(references.find(c => c.id === 'owner-total-request-10000-caps-at-7500')!.input);

describe('IRA modified incomes, eligibility, deductions and carried basis', () => {
  it.each(references)('$id', c => {
    const i = c.input;
    expect(resolveIraContributions(mustValidate(i.plan), i.facts, i.rental, i.requests, i.workplace, i.rules)).toEqual(c.expected);
  });
  it('does not infer workplace coverage from a growth-only old 401(k)', () => {
    const i = sample();
    const plan = { ...i.plan, accounts: [...i.plan.accounts, { ...i.plan.accounts[0]!, id: 'old-plan', type: 'traditional-401k' as const, openingBalanceCents: 10000000 }] };
    const result = resolveIraContributions(mustValidate(plan), i.facts, i.rental, i.requests, i.workplace, i.rules);
    expect(result.federalDeductibleCents).toEqual({ status: 'available', value: 750000 });
  });
  it('locates coverage answers that contradict a current funded 401(k)', () => {
    const i = sample();
    const plan = { ...i.plan, accounts: [...i.plan.accounts, { ...i.plan.accounts[0]!, id: 'current-plan', type: 'traditional-401k' as const }], contributions: [...i.plan.contributions, { id: 'current-rule', accountId: 'current-plan', priority: 0, startDate: '2026-01-01', amount: { kind: 'fixed' as const, monthlyCents: 100000 }, sponsoringSalaryId: 'salary-a' }] };
    const current = { ruleId: 'current-rule', accountId: 'current-plan', ownerId: 'owner-a', year: 2026, month: 1, requestedCents: 100000, eligibleCents: { status: 'available' as const, value: 100000 }, deductibleCents: { status: 'available' as const, value: 100000 }, nondeductibleCents: { status: 'available' as const, value: 0 }, preventedCents: { status: 'available' as const, value: 0 }, reasons: [] };
    const workplace = { ...i.workplace, records: [current] };
    const result = resolveIraContributions(mustValidate(plan), i.facts, i.rental, i.requests, workplace, i.rules);
    expect(result.federalDeductibleCents.status).toBe('unsupported-case');
    expect(result.federalDeductibleCents).not.toHaveProperty('value');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'conflicting-workplace-coverage', field: 'workplaceCoverage', year: 2026 }));
  });
  it('reduces IRA compensation by current traditional workplace deferrals', () => {
    const i = sample();
    const filer = { ...i.plan.household.filers[0], workplaceCoverage: { known: true as const, value: true } };
    const plan: PlanDocument = { ...i.plan, household: { ...i.plan.household, filers: [filer, i.plan.household.filers[1]] }, accounts: [...i.plan.accounts, { ...i.plan.accounts[0]!, id: 'current-plan', type: 'traditional-401k' }], contributions: [...i.plan.contributions, { id: 'current-rule', accountId: 'current-plan', priority: 0, startDate: '2026-01-01', amount: { kind: 'fixed', monthlyCents: 2000000 }, sponsoringSalaryId: 'salary-a' }] };
    const current = { ruleId: 'current-rule', accountId: 'current-plan', ownerId: 'owner-a', year: 2026, month: 1, requestedCents: 2000000, eligibleCents: { status: 'available' as const, value: 2000000 }, deductibleCents: { status: 'available' as const, value: 2000000 }, nondeductibleCents: { status: 'available' as const, value: 0 }, preventedCents: { status: 'available' as const, value: 0 }, reasons: [] };
    const workplace: WorkplaceYear = { ...i.workplace, records: [current], compensationByOwner: [{ ...i.workplace.compensationByOwner[0]!, annualCents: 2000000, monthlyCents: [2000000, ...Array<number>(11).fill(0)] }, i.workplace.compensationByOwner[1]!] };
    const result = resolveIraContributions(mustValidate(plan), i.facts, i.rental, i.requests, workplace, i.rules);
    expect(result.records[0]?.eligibleCents).toEqual({ status: 'available', value: 0 });
    expect(result.owners[0]?.compensationCents).toEqual({ status: 'available', value: 0 });
  });
  it('keeps a covered owner deduction available when only the spouse has a contradictory coverage answer', () => {
    const rules = sample().rules;
    const base = makePlan();
    const plan = mustValidate({ ...base, household: { ...base.household, filers: [{ ...base.household.filers[0], workplaceCoverage: { known: true, value: true } }, base.household.filers[1]] },
      salaries: [{ id: 'salary-a', name: 'Salary A', ownerId: 'owner-a', employerId: 'employer-a', annualGrossCents: 12000000, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] }, { id: 'salary-b', name: 'Salary B', ownerId: 'owner-b', employerId: 'employer-b', annualGrossCents: 1000000, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] }],
      accounts: [{ id: 'ira-a', name: 'IRA', ownerId: 'owner-a', type: 'traditional-ira', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: true, value: 0 } }, { id: 'plan-b', name: 'Plan', ownerId: 'owner-b', type: 'traditional-401k', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false } }],
      contributions: [{ id: 'workplace-b', accountId: 'plan-b', priority: 0, startDate: '2026-01-01', endDate: '2026-01-31', amount: { kind: 'fixed', monthlyCents: 10000 }, sponsoringSalaryId: 'salary-b' }, { id: 'ira-rule-a', accountId: 'ira-a', priority: 1, startDate: '2026-01-01', endDate: '2026-01-31', amount: { kind: 'fixed', monthlyCents: 750000 } }],
    });
    const cash = resolveCashYear(plan, 2026), requests = requestContributions(plan, cash);
    const workplace = resolveWorkplaceContributions(plan, cash, requests, rules);
    const opening = initialTaxState(plan), property = buildPropertyFacts(plan, cash, [], opening, rules);
    const facts = buildPreIraFacts(cash, workplace, property), rental = resolveRentalLosses(facts, opening, rules);
    const result = resolveIraContributions(plan, facts, rental, requests, workplace, rules);
    expect(result.federalDeductibleCents).toEqual({ status: 'available', value: 717000 });
  });
  it('keeps allowed rental loss in IRA MAGI while excluding it from passive allowance MAGI', () => {
    const i = references.find(c => c.id === 'rental-ira-magi-differs-from-passive-magi')!.input;
    expect(traditionalIraMagi(i.facts, i.rental, i.rules)).toEqual({ status: 'available', value: 10500000 });
    expect(rothIraMagi(i.facts, i.rental, i.rules)).toEqual({ status: 'available', value: 10500000 });
    expect(passiveAllowanceMagi(i.facts, i.rules)).toEqual({ status: 'available', value: 12000000 });
  });
  it('restores IRA deduction before the Roth worksheet ceiling check', () => {
    const i = references.find(c => c.id === 'roth-worksheet-ira-addback-over-ceiling')!.input;
    expect(rothIraMagi(i.facts, i.rental, i.rules)).toEqual({ status: 'available', value: 25650000 });
    expect(resolveIraContributions(mustValidate(i.plan), i.facts, i.rental, i.requests, i.workplace, i.rules).records[0]?.eligibleCents).toEqual({ status: 'available', value: 0 });
  });
  it('keeps unknown coverage separate from structurally legal traditional IRA funding', () => {
    const i = sample();
    const filer = i.plan.household.filers[0];
    const plan: PlanDocument = { ...i.plan, household: { ...i.plan.household, filers: [{ ...filer, workplaceCoverage: { known: false } }, i.plan.household.filers[1]] } };
    const result = resolveIraContributions(mustValidate(plan), i.facts, i.rental, i.requests, i.workplace, i.rules);
    expect(result.records[0]?.eligibleCents).toEqual({ status: 'available', value: 750000 });
    expect(result.records[0]?.deductibleCents.status).toBe('needs-data');
    expect(result.records[0]?.deductibleCents).not.toHaveProperty('value');
  });
  it('uses explicit annual workplace coverage over the baseline answer', () => {
    const i = structuredClone(references.find(c => c.id === 'covered-deduction-upper-bound-nondeductible-funding')!.input);
    const filer = i.plan.household.filers[0];
    const plan: PlanDocument = { ...i.plan, household: { ...i.plan.household, filers: [{ ...filer, coverageByYear: [{ year: 2026, workplaceCoverage: { known: true, value: false } }] }, i.plan.household.filers[1]] } };
    expect(resolveIraContributions(mustValidate(plan), i.facts, i.rental, i.requests, i.workplace, i.rules).federalDeductibleCents).toEqual({ status: 'available', value: 750000 });
  });
  it('leaves Roth deposits unavailable when rental history makes its MAGI unavailable', () => {
    const i = structuredClone(references.find(c => c.id === 'roth-lower-bound')!.input);
    const missing = { status: 'needs-data' as const, issues: [{ code: 'required-history', recordId: 'rental-a', year: 2026, severity: 'warning' as const, explanation: 'Unknown rental', resolution: 'Supply opening book' }] };
    const rental = { ...i.rental, federal: missing };
    const result = resolveIraContributions(mustValidate(i.plan), i.facts, rental, i.requests, i.workplace, i.rules);
    expect(result.records[0]?.eligibleCents.status).toBe('needs-data');
    expect(result.records[0]?.eligibleCents).not.toHaveProperty('value');
    expect(result.federalDeductibleCents).toEqual({ status: 'available', value: 0 });
  });
  it('carries unknown old basis while identifying new nondeductible contributions', () => {
    const i = references.find(c => c.id === 'unknown-opening-basis-identifiable-current-funding')!.input;
    const result = resolveIraContributions(mustValidate(i.plan), i.facts, i.rental, i.requests, i.workplace, i.rules);
    expect(result.owners[0]?.newBasisCents).toEqual({ status: 'available', value: 750000 });
    expect(result.owners[0]?.closingBasis).toEqual({ known: false });
  });
  it('carries $100 plus $50 to $150, then uses carried $150 plus $50 to reach $200', () => {
    const firstInput = references.find(c => c.id === 'basis-year-one-100-plus50')!.input;
    const secondInput = references.find(c => c.id === 'basis-year-two-150-plus50')!.input;
    const first = resolveIraContributions(mustValidate(firstInput.plan), firstInput.facts, firstInput.rental, firstInput.requests, firstInput.workplace, firstInput.rules);
    const carried = { ...secondInput.rental, closing: { ...secondInput.rental.closing, iraBasisByOwner: first.closingIraBasisByOwner } };
    const second = resolveIraContributions(mustValidate(secondInput.plan), secondInput.facts, carried, secondInput.requests, secondInput.workplace, secondInput.rules);
    expect(first.closingIraBasisByOwner['owner-a']).toEqual({ known: true, value: 15000 });
    expect(second.closingIraBasisByOwner['owner-a']).toEqual({ known: true, value: 20000 });
  });
  it('builds separate final federal/California/AMT AGIs and named modified incomes', () => {
    const i = references.find(c => c.id === 'rental-ira-magi-differs-from-passive-magi')!.input;
    const ira = resolveIraContributions(mustValidate(i.plan), i.facts, i.rental, i.requests, i.workplace, i.rules);
    const facts = buildResolvedTaxFacts(i.facts, i.rental, ira, i.workplace);
    expect(facts.year).toBe(2026);
    expect(facts.filers).toHaveLength(2);
    expect(facts.federalAgiCents).toEqual({ status: 'available', value: 9750000 });
    expect(facts.californiaAgiCents).toEqual({ status: 'available', value: 9750000 });
    expect(facts.federalAmtIncomeCents).toEqual({ status: 'available', value: 9750000 });
    expect(facts.traditionalIraMagiCents).toEqual({ status: 'available', value: 10500000 });
    expect(facts.passiveAllowanceMagiCents).toEqual({ status: 'available', value: 12000000 });
    expect(facts.saltMagiCents).toEqual({ status: 'available', value: 9750000 });
  });
});
