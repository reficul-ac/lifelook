import { describe, expect, it } from 'vitest';
import { Decimal, CalculationRangeError, settleCents, settleSeries } from '../../src/engine/money';
import { calendarDate, daysInMonth, isValidISODate } from '../../src/engine/dates';
import { createPlan, validatePlan } from '../../src/engine/validation';
import { checkCoverage } from '../../src/engine/coverage';
import { initialTaxState } from '../../src/engine/model/tax-state';
import type { Account, Property, RentalUnit, Salary } from '../../src/engine/model/plan';
import { makePlan, mustValidate } from '../helpers/plans';

const salary: Salary = { id: 'salary-a', name: 'Salary', ownerId: 'owner-a', employerId: 'employer-a', annualGrossCents: 100001, startDate: '2020-01-01', annualRaiseBps: 0, raiseMonth: 2, raiseDay: 29, changes: [] };
const account: Account = { id: 'account-a', name: 'IRA', ownerId: 'owner-a', type: 'traditional-ira', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false } };
const property: Property = { id: 'property-a', name: 'Rental', role: 'rental', purchaseDate: '2020-01-01', purchasePriceCents: 10000000, downPaymentCents: 2000000, openingValueCents: 10000000, appreciationBps: 0, appreciationOverrides: [], loans: [] };
const rental: RentalUnit = {
  id: 'rental-a', propertyId: 'property-a', monthlyRentCents: 0, rentGrowthBps: 0, rentStartDate: '2020-01-01', availableDate: '2020-01-01',
  activeParticipation: { known: true, value: true }, conversionBuildingFmv: { known: false }, loanAllocations: [],
  qualifications: {
    longTermFairMarketLease: { known: true, value: true }, noPersonalUse: { known: true, value: true },
    noSubstantialTenantServices: { known: true, value: true }, ordinaryResidential: { known: true, value: true }, advancedBasisAdjustments: { known: true, value: false },
  },
  convertedFromPersonalUse: false,
  taxHistory: { federal: { known: false }, california: { known: false }, 'federal-amt': { known: false }, 'california-amt': { known: false } },
  qbi: { qualification: { known: false }, wagesCents: { known: false }, ubiaCents: { known: false }, openingLossVintages: { known: false } },
};

function reject(raw: unknown, recordId?: string, field?: string): void {
  const result = validatePlan(raw);
  expect(result.ok).toBe(false);
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', ...(recordId ? { recordId } : {}), ...(field ? { field } : {}) })]));
}

describe('exact money and calendar primitives', () => {
  it('settles cumulative annual cents and signed ties', () => {
    expect(settleCents(new Decimal('0.5'))).toBe(1);
    expect(settleCents(new Decimal('-0.5'))).toBe(-1);
    expect(settleSeries(Array.from({ length: 12 }, () => new Decimal(100001).div(12))).reduce((a, b) => a + b, 0)).toBe(100001);
    expect(settleSeries([new Decimal('-0.25'), new Decimal('-0.25'), new Decimal('-0.25'), new Decimal('-0.25')])).toEqual([0, -1, 0, 0]);
  });
  it.each(['NaN', 'Infinity', '-Infinity', '100000000000000', '-100000000000000'])('rejects nonfinite or over-limit monetary value %s', value => {
    expect(() => settleCents(new Decimal(value))).toThrow(CalculationRangeError);
  });
  it('checks cumulative overflow before number conversion and preserves the decimal constructor configuration', () => {
    expect(() => settleSeries([new Decimal('99999999999999'), new Decimal(1)])).toThrow(CalculationRangeError);
    expect(Decimal.precision).toBeGreaterThanOrEqual(34);
    expect(new CalculationRangeError().code).toBe('monetary-overflow');
    expect(settleCents(new Decimal('99999999999999'))).toBe(99999999999999);
  });
  it('clamps leap dates and injects the default year', () => {
    expect(calendarDate(2027, 2, 29)).toBe('2027-02-28');
    expect(calendarDate(2024, 2, 29)).toBe('2024-02-29');
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(createPlan('2026-10-11', 'new').startYear).toBe(2027);
    expect(createPlan('2026-10-11', 'new').horizonYears).toBe(30);
    expect(() => createPlan('2026-02-30', 'new')).toThrow(RangeError);
  });
  it('starts a document with unknown age and workplace coverage', () => {
    const plan = createPlan('2026-10-11', 'new');
    expect(plan.household.filers[0].birthDate).toEqual({ known: false });
    expect(plan.household.filers[0].workplaceCoverage).toEqual({ known: false });
    expect(checkCoverage(mustValidate(plan), 2027).completeHouseholdLiability).toBe(false);
  });
});

describe('plan structural validation', () => {
  it('validates and deep freezes a copy without mutating the input', () => {
    const raw = makePlan({ salaries: [salary] });
    const before = JSON.stringify(raw);
    const result = validatePlan(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected valid plan');
    expect(result.plan).not.toBe(raw);
    expect(Object.isFrozen(result.plan.salaries[0])).toBe(true);
    expect(JSON.stringify(raw)).toBe(before);
  });
  it.each([0, 41])('rejects horizon %i', horizonYears => { reject(makePlan({ horizonYears }), 'synthetic-plan', 'horizonYears'); });
  it.each([null, [], {}, 'bad'])('rejects malformed document %j without throwing', raw => { reject(raw); });
  it('rejects duplicate IDs across collections', () => { reject(makePlan({ salaries: [salary], accounts: [{ ...account, id: 'salary-a' }] }), 'salary-a', 'id'); });
  it('rejects a dangling owner reference', () => { reject(makePlan({ salaries: [{ ...salary, ownerId: 'missing' }] }), 'salary-a', 'ownerId'); });
  it('rejects a dangling contribution account and salary reference', () => {
    reject(makePlan({ contributions: [{ id: 'rule-a', accountId: 'missing', priority: 1, startDate: '2026-01-01', amount: { kind: 'salary-percent', salaryId: 'missing', percentBps: 1000 } }] }), 'rule-a', 'accountId');
  });
  it('rejects invalid dates and inverted inclusive ranges', () => {
    reject(makePlan({ salaries: [{ ...salary, startDate: '2026-02-29' }] }), 'salary-a', 'startDate');
    reject(makePlan({ salaries: [{ ...salary, endDate: '2019-12-31' }] }), 'salary-a', 'endDate');
  });
  it('rejects unknown enums', () => { reject({ ...makePlan(), accounts: [{ ...account, type: 'crypto' }] }, 'account-a', 'type'); });
  it('rejects wage records without employer and owner', () => {
    reject({ ...makePlan(), otherIncome: [{ id: 'wages', name: 'Wages', amountCents: 0, frequency: 'monthly', startDate: '2026-01-01', annualGrowthBps: 0, classification: 'wage' }] }, 'wages', 'ownerId');
  });
  it('rejects repeated same-date explicit salary changes', () => {
    reject(makePlan({ salaries: [{ ...salary, changes: [{ date: '2026-02-01', kind: 'percent', percentBps: 100 }, { date: '2026-02-01', kind: 'amount', annualGrossCents: 2 }] }] }), 'salary-a', 'changes[1].date');
  });
  it.each([-1, 1.5, null, '12000000', 100000000000000])('rejects invalid automatic salary raise cap %s', annualRaiseCapCents => {
    reject({ ...makePlan(), salaries: [{ ...salary, annualRaiseCapCents }] }, 'salary-a', 'annualRaiseCapCents');
  });
  it('rejects a raise cap below the initial salary', () => {
    reject(makePlan({ salaries: [{ ...salary, annualRaiseCapCents: 100000 }] }), 'salary-a', 'annualRaiseCapCents');
  });
  it('allows an omitted or equal raise cap and dated overrides above it', () => {
    expect(validatePlan(makePlan({ salaries: [salary] })).ok).toBe(true);
    expect(validatePlan(makePlan({ salaries: [{ ...salary, annualRaiseCapCents: 100001, changes: [{ date: '2026-02-01', kind: 'amount', annualGrossCents: 200000 }] }] })).ok).toBe(true);
    expect(validatePlan(makePlan({ salaries: [{ ...salary, annualGrossCents: 0, annualRaiseCapCents: 0 }] })).ok).toBe(true);
  });
  it.each([-1, Number.MAX_SAFE_INTEGER, 100000000000000, 1.5, NaN])('rejects invalid nonnegative amount %s', amount => {
    reject(makePlan({ accounts: [{ ...account, openingBalanceCents: amount }] }), 'account-a', 'openingBalanceCents');
  });
  it.each([-10000, 100001, 0.5, Infinity])('rejects unsupported growth %s', annualGrowthBps => {
    reject(makePlan({ accounts: [{ ...account, annualGrowthBps }] }), 'account-a', 'annualGrowthBps');
  });
  it('allows negative growth and signed opening cash', () => { expect(validatePlan(makePlan({ openingCashCents: -1, accounts: [{ ...account, annualGrowthBps: -9999 }] })).ok).toBe(true); });
  it('rejects negative APR', () => {
    reject(makePlan({ debts: [{ id: 'debt-a', name: 'Debt', openingBalanceCents: 0, aprBps: -1, monthlyPaymentCents: 0, firstPaymentMonth: '2026-01' }] }), 'debt-a', 'aprBps');
  });
  it('rejects invalid allocation fractions', () => {
    reject(makePlan({ properties: [property], rentals: [{ ...rental, sharedAllocation: { numerator: 2, denominator: 1 } }] }), 'rental-a', 'sharedAllocation');
  });
  it('rejects properties and rentals not existing at forecast start', () => {
    reject(makePlan({ properties: [{ ...property, purchaseDate: '2026-01-02' }] }), 'property-a', 'purchaseDate');
    reject(makePlan({ properties: [property], rentals: [{ ...rental, availableDate: '2026-01-02' }] }), 'rental-a', 'availableDate');
  });
  it('requires exact two filer profiles and supported tax policy', () => {
    reject({ ...makePlan(), household: { ...makePlan().household, filers: [] } });
    reject({ ...makePlan(), taxPolicy: { ...makePlan().taxPolicy, baselineYear: 2025 } }, 'synthetic-plan', 'taxPolicy.baselineYear');
  });
  it('rejects malformed known-history payloads without inventing zero', () => {
    reject({ ...makePlan(), accounts: [{ ...account, openingIraBasis: { known: true } }] }, 'account-a', 'openingIraBasis.value');
    reject({ ...makePlan(), accounts: [{ ...account, openingIraBasis: { known: false, value: 0 } }] }, 'account-a', 'openingIraBasis');
  });
  it('rejects aggregate monetary overflow in individually valid inputs', () => {
    reject(makePlan({ accounts: [{ ...account, openingBalanceCents: 99999999999999 }, { ...account, id: 'account-b', openingBalanceCents: 1 }] }), 'synthetic-plan', 'accounts.openingBalanceCents');
  });
  it('rejects non-JSON and cyclic extra fields without throwing', () => {
    const extra = { ...makePlan(), injected: () => 0 };
    reject(extra, 'synthetic-plan', 'injected');
    const cyclic: Record<string, unknown> = { ...makePlan() };
    cyclic.injected = cyclic;
    reject(cyclic, 'synthetic-plan', 'injected');
  });
  it('validates source-qualified opening losses and complete rental book payloads', () => {
    const knownBook = { recoveryBasisCents: 100, adjustedBuildingBasisCents: 90, cumulativeDepreciationCents: 10, atRiskCents: 100, atRiskSuspendedCents: 2, passiveSuspendedCents: 3, lossVintages: [{ year: 2025, source: 'at-risk' as const, amountCents: 2 }, { year: 2025, source: 'passive' as const, amountCents: 3 }] };
    const declared = { ...rental, taxHistory: { ...rental.taxHistory, federal: { known: true as const, value: knownBook } } };
    const state = initialTaxState(mustValidate(makePlan({ properties: [property], rentals: [declared] })));
    expect(state.rentals['rental-a']?.federal).toEqual({ status: 'available', value: knownBook });
    expect(state.rentals['rental-a']?.california.status).toBe('needs-data');
    reject(makePlan({ properties: [property], rentals: [{ ...declared, taxHistory: { ...declared.taxHistory, federal: { known: true, value: { ...knownBook, passiveSuspendedCents: 4 } } } }] }), 'rental-a', 'taxHistory.federal.value.lossVintages');
  });
  it('preserves unknown basis and independent unknown tax books in valid editable documents', () => {
    const plan = mustValidate(makePlan({ properties: [property], rentals: [rental], accounts: [account] }));
    expect(plan.accounts[0]?.openingIraBasis).toEqual({ known: false });
    const state = initialTaxState(plan);
    expect(state.iraBasisByOwner['owner-a']).toEqual({ known: false });
    expect(state.rentals['rental-a']?.federal.status).toBe('needs-data');
    expect(state.rentals['rental-a']?.['california-amt'].status).toBe('needs-data');
    const coverage = checkCoverage(plan, 2026);
    expect(coverage.completeForModeledScope).toBe(false);
    expect(coverage.issues).toEqual(expect.arrayContaining([expect.objectContaining({ recordId: 'rental-a', code: 'required-history' })]));
  });
  it('retains confirmed zero history and complete known-empty coverage', () => {
    const plan = mustValidate(makePlan({ accounts: [{ ...account, openingIraBasis: { known: true, value: 0 } }] }));
    expect(initialTaxState(plan).iraBasisByOwner['owner-a']).toEqual({ known: true, value: 0 });
    expect(checkCoverage(plan, 2026).completeForModeledScope).toBe(true);
    expect(checkCoverage(plan, 2026).completeHouseholdLiability).toBe(true);
  });
  it('discloses omitted retirement distributions in dependent late years', () => {
    const base = makePlan({ accounts: [{ ...account, openingBalanceCents: 100 }] });
    const plan = mustValidate({ ...base, household: { ...base.household, filers: [{ ...base.household.filers[0], birthDate: { known: true, value: '1950-01-01' } }, base.household.filers[1]] } });
    expect(checkCoverage(plan, 2026).completeHouseholdLiability).toBe(false);
    expect(checkCoverage(plan, 2026).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'omitted-distributions', year: 2026 })]));
  });
});
