import { describe, expect, it } from 'vitest';
import { calculateProjection } from '../../src/engine/projection';
import { loadRuleSet } from '../../src/engine/rules/registry';
import { validatePlan } from '../../src/engine/validation';
import type { AllocationDestination, CashFlowAllocationEntry, History, PlanDocument } from '../../src/engine/model/plan';
import { makeAllocationPlan, makeAllocationPolicy } from '../helpers/allocations';
import { mustValidate } from '../helpers/plans';

function fixture(): PlanDocument {
  const base = makeAllocationPlan();
  return { ...base, accounts: [...base.accounts, { ...base.accounts[1]!, id: 'roth-ira', type: 'roth-ira' }], salaries: [{ ...base.salaries[0]!, annualGrossCents: 40000000 }],
    cashFlowAllocation: makeAllocationPolicy({ entries: [{ id: 'backdoor', priority: 1,
      destination: { kind: 'account', accountId: 'roth-ira', backdoorRoth: { traditionalIraAccountId: 'ira', cleanIraHistory: { known: true, value: true } } },
      amount: { kind: 'max-annual' } }] }) };
}
const project = (document: PlanDocument) => calculateProjection(mustValidate(document), loadRuleSet());
function money(value: { status: string; value?: number }): number { expect(value.status).toBe('available'); return value.value!; }
function route(history: History<boolean> = { known: true, value: true }): AllocationDestination {
  return { kind: 'account', accountId: 'roth-ira', backdoorRoth: { traditionalIraAccountId: 'ira', cleanIraHistory: history } };
}
function withEntries(plan: PlanDocument, entries: readonly CashFlowAllocationEntry[], overflow: AllocationDestination = { kind: 'cash' }): PlanDocument {
  return { ...plan, cashFlowAllocation: makeAllocationPolicy({ entries, overflow: { id: 'excess', destination: overflow } }) };
}
const max = (destination = route()): CashFlowAllocationEntry => ({ id: 'backdoor', priority: 1, destination, amount: { kind: 'max-annual' } });
const percent = (bps: number, destination = route()): CashFlowAllocationEntry => ({ id: 'backdoor', priority: 1, destination, amount: { kind: 'percent', percentBps: bps } });

describe('clean same-year backdoor Roth allocation', () => {
  it('funds and converts the annual IRA cap when direct Roth eligibility is zero', () => {
    const plan = fixture(), saved = structuredClone(plan), result = project(plan), year = result.years[0]!;
    expect(year.cashFlowAllocation?.status).toBe('available');
    expect(year.household.status).toBe('available');
    if (year.household.status !== 'available') throw new Error('household');
    const owner = year.household.value.ira.owners.find(owner => owner.ownerId === 'owner-a')!;
    expect(money(owner.rothContributionLimitCents)).toBe(0);
    expect(money(year.eligibleContributionCents)).toBe(750000);
    expect(money(year.accounts.find(account => account.accountId === 'ira')!.closingCents)).toBe(0);
    expect(money(year.accounts.find(account => account.accountId === 'roth-ira')!.closingCents)).toBe(750000);
    expect(result.closingTaxState.iraBasisByOwner['owner-a']).toEqual({ known: true, value: 0 });
    expect(money(owner.federalDeductibleCents)).toBe(0);
    expect(money(owner.californiaDeductibleCents)).toBe(0);
    expect(money(owner.newBasisCents)).toBe(750000);
    const traditional = year.accounts.find(account => account.accountId === 'ira')!, roth = year.accounts.find(account => account.accountId === 'roth-ira')!;
    expect(money(traditional.contributionCents)).toBe(750000);
    expect(money(traditional.conversionOutCents!)).toBe(750000);
    expect(money(roth.contributionCents)).toBe(0);
    expect(money(roth.conversionInCents!)).toBe(750000);
    expect(result.months.map(month => money(month.accounts.find(account => account.accountId === 'roth-ira')!.conversionInCents!))).toEqual(Array(12).fill(62500));
    expect(money(year.accountBalanceCents)).toBe(750000);
    expect(money(year.cashFlowCents)).toBe(money(year.salaryCents) - money(year.totalTaxCents) - 750000);
    if (year.cashFlowAllocation?.status !== 'available') throw new Error('allocation');
    const report = year.cashFlowAllocation.value;
    expect(report.accounts).toEqual([expect.objectContaining({ accountId: 'roth-ira', actualCents: 750000, maximumCents: 750000 })]);
    expect(money(report.accounts[0]!.share)).toBe(750000 / report.originalCashFlowCents);
    expect(plan).toEqual(saved);
  });
  it('repeats conversion with fresh projected annual limits and carries only Roth assets for two years', () => {
    const plan = fixture(), result = project({ ...plan, horizonYears: 2, taxPolicy: { ...plan.taxPolicy, futureIndexGrowthBps: 1000 }, accounts: plan.accounts.map(account => ({ ...account, annualGrowthBps: 1200 })) });
    expect(result.years.map(year => money(year.eligibleContributionCents))).toEqual([750000, 800000]);
    // $625 month-end conversions grow to $7,904.06 at 12% effective annual growth.
    expect(money(result.years[0]!.accounts.find(account => account.accountId === 'roth-ira')!.growthCents)).toBe(40406);
    for (const year of result.years) {
      expect(money(year.accounts.find(account => account.accountId === 'ira')!.closingCents)).toBe(0);
      const roth = year.accounts.find(account => account.accountId === 'roth-ira')!;
      expect(money(roth.closingCents)).toBe(money(roth.openingCents) + money(roth.growthCents) + money(roth.conversionInCents!));
    }
    expect(result.taxStates.map(state => state.closing.iraBasisByOwner['owner-a'])).toEqual([{ known: true, value: 0 }, { known: true, value: 0 }]);
    expect(result.years[1]!.provenance.some(p => p.status === 'projected' && p.applicableYear === 2027)).toBe(true);
  });
  it('elects nondeductible treatment in both books even when a traditional IRA deduction is available', () => {
    const plan = fixture(), result = project({ ...plan, salaries: [{ ...plan.salaries[0]!, annualGrossCents: 8000000 }] }), year = result.years[0]!;
    if (year.household.status !== 'available') throw new Error('household');
    const owner = year.household.value.ira.owners.find(owner => owner.ownerId === 'owner-a')!;
    expect(money(owner.traditionalDeductionLimitCents)).toBe(750000);
    expect(money(owner.federalDeductibleCents)).toBe(0);
    expect(money(owner.californiaDeductibleCents)).toBe(0);
    const direct = project(withEntries({ ...plan, salaries: [{ ...plan.salaries[0]!, annualGrossCents: 8000000 }] }, [max({ kind: 'account', accountId: 'roth-ira' })])).years[0]!;
    expect(year.totalTaxCents).toEqual(direct.totalTaxCents);
  });
  it.each([
    { label: 'unknown clean history', history: { known: false }, status: 'needs-data', code: 'required-clean-ira-history' },
    { label: 'declared nonclean history', history: { known: true, value: false }, status: 'unsupported-case', code: 'unsupported-backdoor-ira-history' },
  ] as const)('blocks $label without reporting a tax-free conversion', ({ history, status, code }) => {
    const year = project(withEntries(fixture(), [max(route(history))])).years[0]!;
    expect(year.cashFlowAllocation?.status).toBe(status);
    expect(year.issues.some(issue => issue.code === code && issue.field?.includes('destination.backdoorRoth'))).toBe(true);
    expect(year.accounts.find(account => account.accountId === 'roth-ira')!.conversionInCents?.status).toBe(status);
    expect(year.accounts.find(account => account.accountId === 'ira')!.closingCents.status).toBe(status);
  });
  it.each([
    { basis: { known: false }, balance: 0, status: 'needs-data', code: 'required-backdoor-ira-basis' },
    { basis: { known: true, value: 1 }, balance: 0, status: 'unsupported-case', code: 'unsupported-backdoor-ira-basis' },
    { basis: { known: true, value: 0 }, balance: 1, status: 'unsupported-case', code: 'unsupported-backdoor-ira-balance' },
  ] as const)('blocks incompatible basis/balance $code', ({ basis, balance, status, code }) => {
    const plan = fixture(), result = project({ ...plan, accounts: plan.accounts.map(account => account.id === 'ira' ? { ...account, openingIraBasis: basis, openingBalanceCents: balance } : account) });
    expect(result.years[0]!.cashFlowAllocation?.status).toBe(status);
    expect(result.issues.some(issue => issue.code === code)).toBe(true);
    expect(result.issues.find(issue => issue.code === code)?.recordId).toBe('ira');
  });
  it('checks every same-owner traditional IRA, independently of the linked source', () => {
    const plan = fixture(), extra = { ...plan.accounts[1]!, id: 'rollover-ira', openingBalanceCents: 100 };
    const result = project({ ...plan, accounts: [...plan.accounts, extra] });
    expect(result.years[0]!.cashFlowAllocation?.status).toBe('unsupported-case');
    expect(result.issues.some(issue => issue.code === 'unsupported-backdoor-ira-balance')).toBe(true);
    expect(result.issues.find(issue => issue.code === 'unsupported-backdoor-ira-balance')).toMatchObject({ recordId: 'rollover-ira', field: 'openingBalanceCents' });
    expect(project({ ...plan, accounts: [...plan.accounts, { ...extra, ownerId: 'owner-b' }] }).years[0]!.cashFlowAllocation?.status).toBe('available');
  });
  it('preserves legal zero and zero percentage when route history is unknown', () => {
    const plan = fixture();
    expect(money(project(withEntries(plan, [percent(0, route({ known: false }))])).years[0]!.eligibleContributionCents)).toBe(0);
    expect(money(project(withEntries({ ...plan, salaries: [] }, [max(route({ known: false }))])).years[0]!.eligibleContributionCents)).toBe(0);
  });
  it('shares the annual IRA cap with saved direct Roth deposits without changing their dates', () => {
    const plan = fixture(), contributions: PlanDocument['contributions'] = [{ id: 'saved-roth', accountId: 'roth-ira', priority: 0, startDate: '2026-01-01', endDate: '2026-01-31', amount: { kind: 'fixed', monthlyCents: 200000 } }];
    const result = project({ ...plan, salaries: [{ ...plan.salaries[0]!, annualGrossCents: 8000000 }], contributions });
    const year = result.years[0]!, roth = year.accounts.find(account => account.accountId === 'roth-ira')!;
    expect(money(year.eligibleContributionCents)).toBe(750000);
    expect(money(roth.contributionCents)).toBe(200000);
    expect(money(roth.conversionInCents!)).toBe(550000);
    expect(result.contributions.filter(record => record.ruleId === 'saved-roth' && money(record.eligibleCents) > 0)).toEqual([expect.objectContaining({ month: 1, requestedCents: 200000 })]);
  });
  it('refuses other funded traditional IRA contributions requiring a broader basis calculation', () => {
    const plan = fixture(), result = project({ ...plan, contributions: [{ id: 'saved-ira', accountId: 'ira', priority: 0, startDate: '2026-01-01', amount: { kind: 'fixed', monthlyCents: 10000 } }] });
    expect(result.years[0]!.cashFlowAllocation?.status).toBe('unsupported-case');
    expect(result.issues.some(issue => issue.code === 'unsupported-backdoor-other-ira-funding')).toBe(true);
  });
  it('uses a common final-tax denominator after a later maximum workplace deferral', () => {
    const plan = fixture(), workplace: CashFlowAllocationEntry = { id: 'max-workplace', priority: 2, destination: { kind: 'account', accountId: 'workplace', sponsoringSalaryId: 'salary-a' }, amount: { kind: 'max-annual' } };
    const year = project(withEntries({ ...plan, household: { ...plan.household, filers: [{ ...plan.household.filers[0], workplaceCoverage: { known: true, value: true } }, plan.household.filers[1]] } }, [percent(100), workplace])).years[0]!;
    if (year.cashFlowAllocation?.status !== 'available') throw new Error('allocation');
    const report = year.cashFlowAllocation.value, account = report.accounts.find(account => account.accountId === 'roth-ira')!;
    expect(report.originalCashFlowCents).toBe(money(year.salaryCents) - money(year.totalTaxCents));
    expect(account.targetCents).toBe(Math.round(report.originalCashFlowCents * 0.01));
    expect(account.actualCents).toBe(account.targetCents);
    expect(money(account.share)).toBe(account.actualCents / report.originalCashFlowCents);
  });
  it('supports percentage then excess through the identical pair, capped once', () => {
    const year = project(withEntries(fixture(), [percent(100)], route())).years[0]!;
    if (year.cashFlowAllocation?.status !== 'available') throw new Error('allocation');
    const account = year.cashFlowAllocation.value.accounts[0]!;
    expect(account.actualCents).toBe(750000);
    expect(account.percentageCents).toBeGreaterThan(0);
    expect(account.excessCents).toBe(750000 - account.percentageCents);
    expect(money(year.eligibleContributionCents)).toBe(750000);
    expect(money(year.accounts.find(account => account.accountId === 'roth-ira')!.conversionInCents!)).toBe(750000);
  });
  it('funds a partial maximum from limited annual cash and retains brokerage excess correctly', () => {
    const plan = fixture(), baseline = project(withEntries(plan, [])).years[0]!, pool = money(baseline.salaryCents) - money(baseline.totalTaxCents);
    const expenses: PlanDocument['expenses'] = [{ id: 'living', name: 'Living', amountCents: pool - 123456, frequency: 'annual', startDate: '2026-01-01', annualGrowthBps: 0, taxCategory: 'personal', use: 'personal' }];
    const year = project(withEntries({ ...plan, expenses }, [max()], { kind: 'account', accountId: 'brokerage' })).years[0]!;
    expect(money(year.eligibleContributionCents)).toBe(123456);
    expect(money(year.accounts.find(account => account.accountId === 'roth-ira')!.conversionInCents!)).toBe(123456);
    expect(money(year.cashFlowCents)).toBe(0);
    expect(money(year.accounts.find(account => account.accountId === 'brokerage')!.closingCents)).toBe(0);
  });
  it('leaves legacy report shapes unchanged without a backdoor route', () => {
    const year = project(withEntries(fixture(), [max({ kind: 'account', accountId: 'roth-ira' })])).years[0]!;
    expect(year.accounts.every(account => !('conversionInCents' in account) && !('conversionOutCents' in account))).toBe(true);
  });
  it('funds both spouses independently while consuming each owner limit once', () => {
    const plan = fixture(), source = { ...plan.accounts[1]!, id: 'ira-b', ownerId: 'owner-b' }, roth = { ...plan.accounts[3]!, id: 'roth-b', ownerId: 'owner-b' };
    const second: CashFlowAllocationEntry = { ...max(), id: 'backdoor-b', priority: 2, destination: { kind: 'account', accountId: roth.id, backdoorRoth: { traditionalIraAccountId: source.id, cleanIraHistory: { known: true, value: true } } } };
    const result = project(withEntries({ ...plan, accounts: [...plan.accounts, source, roth] }, [max(), second])), year = result.years[0]!;
    expect(money(year.eligibleContributionCents)).toBe(1500000);
    expect(result.closingTaxState.iraBasisByOwner).toEqual({ 'owner-a': { known: true, value: 0 }, 'owner-b': { known: true, value: 0 } });
    expect(money(year.accounts.find(account => account.accountId === 'roth-b')!.closingCents)).toBe(750000);
  });
  it('refuses concurrent policy funding of another same-owner traditional IRA', () => {
    const plan = fixture(), extra = { ...plan.accounts[1]!, id: 'other-ira' };
    const direct: CashFlowAllocationEntry = { id: 'other-funding', priority: 0, destination: { kind: 'account', accountId: extra.id }, amount: { kind: 'percent', percentBps: 10 } };
    const year = project(withEntries({ ...plan, accounts: [...plan.accounts, extra] }, [direct, max()])).years[0]!;
    expect(year.cashFlowAllocation?.status).toBe('unsupported-case');
    expect(year.issues.some(issue => issue.code === 'unsupported-backdoor-other-ira-funding')).toBe(true);
  });
});

describe('backdoor route validation', () => {
  it.each(['missing', 'brokerage', 'workplace', 'roth-ira'])('rejects an invalid traditional source %s', source => {
    const plan = fixture(), destination = route();
    if (destination.kind !== 'account') throw new Error('destination');
    expect(validatePlan(withEntries(plan, [max({ ...destination, backdoorRoth: { traditionalIraAccountId: source, cleanIraHistory: { known: true, value: true } } })])).ok).toBe(false);
  });
  it('rejects cross-owner links, cash routes, invalid history, and non-Roth destinations', () => {
    const plan = fixture();
    expect(validatePlan({ ...plan, accounts: plan.accounts.map(account => account.id === 'ira' ? { ...account, ownerId: 'owner-b' } : account) }).ok).toBe(false);
    for (const destination of [{ kind: 'cash', backdoorRoth: {} }, { kind: 'account', accountId: 'ira', backdoorRoth: { traditionalIraAccountId: 'ira', cleanIraHistory: { known: true, value: true } } }, { kind: 'account', accountId: 'roth-ira', backdoorRoth: { traditionalIraAccountId: 'ira', cleanIraHistory: { known: true, value: 'yes' } } }]) {
      expect(validatePlan({ ...plan, cashFlowAllocation: { ...plan.cashFlowAllocation, entries: [{ ...max(), destination }] } }).ok).toBe(false);
    }
  });
  it('rejects direct policy funding of the conversion source and source reuse for another Roth', () => {
    const plan = fixture();
    expect(validatePlan(withEntries(plan, [max()], { kind: 'account', accountId: 'ira' })).ok).toBe(false);
    const secondRoth = { ...plan.accounts[3]!, id: 'second-roth' };
    expect(validatePlan(withEntries({ ...plan, accounts: [...plan.accounts, secondRoth] }, [max()], { kind: 'account', accountId: secondRoth.id, backdoorRoth: { traditionalIraAccountId: 'ira', cleanIraHistory: { known: true, value: true } } })).ok).toBe(false);
    expect(validatePlan(withEntries(plan, [max()], route())).ok).toBe(true);
  });
});
