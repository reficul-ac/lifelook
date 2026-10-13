import { describe, expect, it } from 'vitest';
import { resolveCashYear } from '../../src/engine/cash/income';
import { calculateProjection, loadRuleSet } from '../../src/engine/index';
import { MAX_CENTS } from '../../src/engine/money';
import { makePlan, mustValidate } from '../helpers/plans';
import { makeAllocationPlan, makeAllocationPolicy } from '../helpers/allocations';

const child = (birthMonth = '2026-01', includeAge18 = false, id = 'child-a') => ({ id, name: id, birthMonth, includeAge18 });
const expense = (amountCents = 10000, id = 'living') => ({ id, name: id, amountCents, frequency: 'monthly' as const, startDate: '2026-01-01', annualGrowthBps: 0, use: 'personal' as const, taxCategory: 'personal' as const });
const annualBudgets = [900000,800000,800000,850000,850000,850000,1000000,1000000,1000000,1100000,1100000,1100000,1200000,1200000,1200000,1250000,1600000,1600000];

describe('fixed child planning costs', () => {
  it.each(annualBudgets.map((annualCents, age) => ({ age, annualCents })))('charges the entire supplied age $age budget without indexing', ({ age, annualCents }) => {
    const plan = mustValidate(makePlan({ children: [child()], taxPolicy: { baselineYear: 2026, futureIndexGrowthBps: 1000, actualStateTaxPaidByYear: [] } }));
    const cash = resolveCashYear(plan, 2026 + age);
    expect(cash.annual.expensesCents).toBe(annualCents);
    expect(cash.streams.find(stream => stream.id === 'child-a')).toMatchObject({ kind: 'expense', annualCents });
  });

  it.each([false, true])('preserves the complete childhood total for a November birth, include age 18 = %s', includeAge18 => {
    const plan = mustValidate(makePlan({ children: [child('2026-11', includeAge18)] }));
    const cash = Array.from({ length: 21 }, (_, index) => resolveCashYear(plan, 2026 + index));
    expect(cash.reduce((total, year) => total + year.annual.expensesCents, 0)).toBe(includeAge18 ? 21000000 : 19400000);
    expect(cash[0]!.months.map(month => month.expensesCents)).toEqual([...Array(10).fill(0),75000,75000]);
    const stopYear = includeAge18 ? 2045 : 2044;
    expect(cash.find(year => year.year === stopYear)!.months.slice(10).map(month => month.expensesCents)).toEqual([0,0]);
    expect(cash.find(year => year.year === stopYear - 1)!.months.slice(10).map(month => month.expensesCents)).toEqual([133333,133334]);
  });

  it('starts a future child in the selected birth month and changes age that month', () => {
    const plan = mustValidate(makePlan({ children: [child('2027-03')] }));
    expect(resolveCashYear(plan, 2026).months.map(month => month.expensesCents)).toEqual(Array(12).fill(0));
    expect(resolveCashYear(plan, 2027).months.map(month => month.expensesCents)).toEqual([0,0,...Array(10).fill(75000)]);
    expect(resolveCashYear(plan, 2028).months.map(month => month.expensesCents)).toEqual([75000,75000,66667,66666,66667,66667,66666,66667,66667,66666,66667,66667]);
  });

  it('preserves birth-relative cent rounding when the forecast starts after birth', () => {
    const plan = mustValidate(makePlan({ startYear: 2030, children: [child('2026-11')] }));
    expect(resolveCashYear(plan, 2030).months.map(month => month.expensesCents)).toEqual([70833,70833,70834,70833,70833,70834,70833,70833,70834,70833,70833,70834]);
    const lifeYear = [...resolveCashYear(plan, 2029).months.slice(10),...resolveCashYear(plan, 2030).months.slice(0,10)];
    expect(lifeYear.reduce((total, month) => total + month.expensesCents, 0)).toBe(850000);
  });

  it('combines multiple children with ordinary expenses without changing income or tax classifications', () => {
    const plan = mustValidate(makePlan({ children: [child(),child('2027-07', false, 'child-b')], expenses: [expense()] }));
    const cash = resolveCashYear(plan, 2027);
    expect(cash.streams.filter(stream => stream.kind === 'expense').map(stream => stream.id)).toEqual(['living','child-a','child-b']);
    expect(cash.annual.expensesCents).toBe(1370000);
    expect(cash.months[6]!.expensesCents).toBe(151667);
    expect(cash.annual.grossIncomeCents).toBe(0);
    expect(cash.annual.wageCents).toBe(0);
    expect(cash.annual.ordinaryTaxableCents).toBe(0);
    expect(cash.wages).toEqual([]);
  });

  it('leaves omitted children and explicitly empty children equivalent', () => {
    expect(resolveCashYear(mustValidate(makePlan()), 2026)).toEqual(resolveCashYear(mustValidate(makePlan({ children: [] })), 2026));
  });
});

describe('child expense projection integration', () => {
  it('reduces ordinary cash flow, reserve and net worth without inferring child tax credits', () => {
    const base = makePlan({ openingCashCents: 2000000, expenses: [expense()] });
    const before = calculateProjection(mustValidate(base), loadRuleSet());
    const after = calculateProjection(mustValidate({ ...base, children: [child()] }), loadRuleSet());
    expect(after.months[0]).toMatchObject({ ordinaryExpensesCents: { status: 'available', value: 85000 }, cashFlowCents: { status: 'available', value: -85000 }, reserveCents: { status: 'available', value: 1915000 }, netWorthCents: { status: 'available', value: 1915000 } });
    expect(after.years[0]).toMatchObject({ ordinaryExpensesCents: { status: 'available', value: 1020000 }, propertyExpensesCents: { status: 'available', value: 0 }, cashFlowCents: { status: 'available', value: -1020000 }, reserveCents: { status: 'available', value: 980000 }, netWorthCents: { status: 'available', value: 980000 } });
    expect(after.years[0]!.tax).toEqual(before.years[0]!.tax);
    expect(after.cashSchedules.find(schedule => schedule.recordId === 'child-a')).toMatchObject({ kind: 'expense', schedule: { status: 'available', value: { annualCents: 900000 } } });
    for (const report of [after.months[0]!,after.years[0]!,after]) {
      expect(report.provenance).toContainEqual(expect.objectContaining({ status: 'projected', ruleVersion: 'oceanside-child-planning.1', applicableYear: 2026, sources: expect.arrayContaining(['User-supplied Oceanside child expense planning budget (2026-10-13).']) }));
      expect(report.provenance.flatMap(value => value.assumptions).join(' ')).toMatch(/not inflated|no inflation/i);
      expect(report.provenance.flatMap(value => value.assumptions).join(' ')).toMatch(/housing.*medical.*education.*daycare/i);
    }
  });

  it('deducts child costs before funding cash-flow allocation accounts', () => {
    const plan = makeAllocationPlan({ salaries: [], otherIncome: [{ id: 'cash-receipt', name: 'Cash', amountCents: 100000, frequency: 'monthly', startDate: '2026-01-01', annualGrowthBps: 0, classification: 'non-taxable' }], expenses: [expense()], children: [child()], cashFlowAllocation: makeAllocationPolicy({ overflow: { id: 'invest-excess', destination: { kind: 'account', accountId: 'brokerage' } } }) });
    const result = calculateProjection(mustValidate(plan), loadRuleSet());
    expect(result.years[0]!.cashFlowAllocation).toMatchObject({ status: 'available', value: { originalCashFlowCents: 180000 } });
    expect(result.years[0]!.accounts.find(account => account.accountId === 'brokerage')!.contributionCents).toEqual({ status: 'available', value: 180000 });
    expect(result.years[0]!.reserveCents).toEqual({ status: 'available', value: 0 });
    expect(result.years[0]!.netWorthCents).toEqual({ status: 'available', value: 180000 });
  });

  it('recovers each child and the ordinary expense independently when another expense overflows', () => {
    const plan = makePlan({ children: [child(),child('2026-07', false, 'child-b')], expenses: [expense(),expense(MAX_CENTS, 'overflowing-expense')], salaries: [{ id: 'salary', name: 'Salary', ownerId: 'owner-a', employerId: 'employer', annualGrossCents: 12000000, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] }] });
    const result = calculateProjection(mustValidate(plan), loadRuleSet());
    expect(result.cashSchedules.find(schedule => schedule.recordId === 'child-a')).toMatchObject({ schedule: { status: 'available', value: { annualCents: 900000 } } });
    expect(result.cashSchedules.find(schedule => schedule.recordId === 'child-b')).toMatchObject({ schedule: { status: 'available', value: { annualCents: 450000 } } });
    expect(result.cashSchedules.find(schedule => schedule.recordId === 'living')).toMatchObject({ schedule: { status: 'available', value: { annualCents: 120000 } } });
    expect(result.cashSchedules.find(schedule => schedule.recordId === 'overflowing-expense')!.schedule.status).toBe('unsupported-case');
    expect(result.months[0]!.salaryCents).toEqual({ status: 'available', value: 1000000 });
    expect(result.months[0]!.socialSecurityCents).toEqual({ status: 'available', value: 62000 });
    expect(result.years[0]!.tax.status).toBe('available');
  });

  it('recovers child costs and payroll when an unrelated taxable income overflows', () => {
    const plan = makePlan({ children: [child()], salaries: [{ id: 'salary', name: 'Salary', ownerId: 'owner-a', employerId: 'employer', annualGrossCents: 12000000, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] }], otherIncome: [{ id: 'overflowing-income', name: 'Income', amountCents: MAX_CENTS, frequency: 'monthly', startDate: '2026-01-01', annualGrowthBps: 0, classification: 'ordinary-taxable', niitTreatment: 'included' }] });
    const result = calculateProjection(mustValidate(plan), loadRuleSet());
    expect(result.months[0]!.ordinaryExpensesCents).toEqual({ status: 'available', value: 75000 });
    expect(result.months[0]!.socialSecurityCents).toEqual({ status: 'available', value: 62000 });
    expect(result.years[0]!.tax.status).toBe('unsupported-case');
  });
});
