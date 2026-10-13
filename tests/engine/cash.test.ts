import { describe, expect, it } from 'vitest';
import { resolveCashYear } from '../../src/engine/cash/income';
import { requestContributions } from '../../src/engine/cash/contribution-requests';
import { makePlan, mustValidate } from '../helpers/plans';
import type { Expense, Salary } from '../../src/engine/model/plan';
import type { CashYear } from '../../src/engine/cash/income';
import type { PlanDocument } from '../../src/engine/model/plan';
import { loadReferences } from '../helpers/references';

const salary = (o: Partial<Salary> = {}): Salary => ({ id: 'salary', name: 'Salary', ownerId: 'owner-a', employerId: 'employer-a', annualGrossCents: 100001, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [], ...o });
const expense = (o: Partial<Expense> = {}): Expense => ({ id: 'expense', name: 'Expense', amountCents: 120000, frequency: 'annual', startDate: '2026-01-01', annualGrowthBps: 0, use: 'personal', taxCategory: 'personal', ...o });
const annual = (p: ReturnType<typeof makePlan>, y = p.startYear) => resolveCashYear(mustValidate(p), y);

describe('dated cash streams', () => {
  it.each(loadReferences<PlanDocument, CashYear>('cash'))('$id independently reconciles all cash facts', c => {
    expect(annual(c.input,c.taxYear)).toEqual(c.expected);
  });
  it('settles unchanged annual salary exactly without monthly rounding drift', () => {
    const c = annual(makePlan({ salaries: [salary()] }));
    expect(c.months.map(m => m.grossIncomeCents)).toEqual([8333,8334,8333,8334,8333,8334,8333,8333,8334,8333,8334,8333]);
    expect(c.annual.grossIncomeCents).toBe(100001);
    expect(c.wages[0]!.annualCents).toBe(100001);
  });
  it('prorates leap-year February changes from the first changed day', () => {
    const c = annual(makePlan({ startYear: 2028, salaries: [salary({ startDate: '2028-01-01', annualGrossCents: 12000000, changes: [{ date: '2028-02-15', kind: 'amount', annualGrossCents: 24000000 }] })] }));
    expect(c.months[1]!.salaryCents).toBe(1517241);
    expect(c.months[2]!.salaryCents).toBe(2000000);
  });
  it('pre-forecast-leap-day-midmonth-end', () => {
    const c = annual(makePlan({ startYear: 2027, salaries: [salary({ startDate: '2024-02-29', endDate: '2027-03-15', annualGrossCents: 12000000, annualRaiseBps: 1000, raiseMonth: 2, raiseDay: 29 })] }));
    expect(c.months[0]!.salaryCents).toBe(1210000);
    expect(c.months[1]!.salaryCents).toBe(1214321);
    expect(c.months[2]!.salaryCents).toBe(644033);
    expect(c.months[3]!.salaryCents).toBe(0);
  });
  it('explicit same-day changes suppress automatic raises and anchor subsequent raises', () => {
    const c = annual(makePlan({ startYear: 2027, salaries: [salary({ annualGrossCents: 12000000, annualRaiseBps: 1000, changes: [{ date: '2026-01-01', kind: 'amount', annualGrossCents: 24000000 }] })] }));
    expect(c.months[0]!.salaryCents).toBe(2200000);
    const first = annual(makePlan({ salaries: [salary({ annualGrossCents: 12000000, annualRaiseBps: 1000 })] }));
    expect(first.months[0]!.salaryCents).toBe(1000000);
  });
  it('stops automatic raises at the cap before and throughout the forecast', () => {
    const plan = makePlan({ startYear: 2027, salaries: [salary({ annualGrossCents: 12000000, annualRaiseBps: 2000, raiseMonth: 7, annualRaiseCapCents: 15000000 })] });
    const cash = annual(plan);
    expect(cash.months.map(m => m.salaryCents)).toEqual([...Array(6).fill(1200000), ...Array(6).fill(1250000)]);
    expect(cash.annual.salaryCents).toBe(14700000);
    expect(annual(plan, 2030).months.map(m => m.salaryCents)).toEqual(Array(12).fill(1250000));
    expect(annual(plan, 2030).salaryPeriods.every(p => p.annualGrossCents === 15000000)).toBe(true);
  });
  it('lets dated percentage and amount changes override the automatic raise cap', () => {
    const plan = makePlan({ salaries: [salary({
      annualGrossCents: 12000000, annualRaiseBps: 2000, raiseMonth: 2, annualRaiseCapCents: 12600000,
      changes: [{ date: '2026-03-01', kind: 'percent', percentBps: 2000 }, { date: '2026-07-01', kind: 'amount', annualGrossCents: 18000000 }],
    })] });
    const cash = annual(plan);
    expect(cash.months[1]!.salaryCents).toBe(1050000);
    expect(cash.months[2]!.salaryCents).toBe(1260000);
    expect(cash.months[6]!.salaryCents).toBe(1500000);
    expect(annual(plan, 2027).months.map(m => m.salaryCents)).toEqual(Array(12).fill(1500000));
  });
  it('uses the capped salary for reductions and resumes automatic raises below the cap', () => {
    const plan = makePlan({ salaries: [salary({
      annualGrossCents: 12000000, annualRaiseBps: 2000, raiseMonth: 2, annualRaiseCapCents: 12600000,
      changes: [{ date: '2026-06-01', kind: 'percent', percentBps: -1000 }],
    })] });
    expect(annual(plan).months[5]!.salaryCents).toBe(945000);
    expect(annual(plan, 2027).months[0]!.salaryCents).toBe(945000);
    expect(annual(plan, 2027).months[1]!.salaryCents).toBe(1050000);
  });
  it('preserves a dated change on the automatic raise date even above the cap', () => {
    const plan = makePlan({ salaries: [salary({
      annualGrossCents: 12000000, annualRaiseBps: 2000, raiseMonth: 2, annualRaiseCapCents: 12600000,
      changes: [{ date: '2026-02-01', kind: 'amount', annualGrossCents: 18000000 }],
    })] });
    expect(annual(plan).months[1]!.salaryCents).toBe(1500000);
    expect(annual(plan, 2027).months[1]!.salaryCents).toBe(1500000);
  });
  it('leaves automatic salary reductions unaffected by a raise cap', () => {
    const plan = makePlan({ startYear: 2027, salaries: [salary({
      annualGrossCents: 12000000, annualRaiseBps: -1000, raiseMonth: 2, annualRaiseCapCents: 12600000,
      changes: [{ date: '2026-07-01', kind: 'amount', annualGrossCents: 18000000 }],
    })] });
    expect(annual(plan).months[0]!.salaryCents).toBe(1500000);
    expect(annual(plan).months[1]!.salaryCents).toBe(1350000);
  });
  it('prorates a midmonth capped raise before requesting salary percentage contributions', () => {
    const plan = makePlan({ startYear: 2028, salaries: [salary({
      startDate: '2028-01-01', annualGrossCents: 12000000, annualRaiseBps: 2000, raiseMonth: 2, raiseDay: 15, annualRaiseCapCents: 12600000,
    })], accounts: [{ id: 'account', name: 'Brokerage', ownerId: 'owner-a', type: 'taxable-brokerage', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false } }], contributions: [{
      id: 'percent', accountId: 'account', priority: 1, startDate: '2028-02-15', endDate: '2028-02-29', amount: { kind: 'salary-percent', salaryId: 'salary', percentBps: 1000 },
    }] });
    const cash = annual(plan);
    expect(cash.months[1]!.salaryCents).toBe(1025862);
    expect(cash.months[2]!.salaryCents).toBe(1050000);
    expect(requestContributions(mustValidate(plan), cash).find(r => r.month === 2)?.requestedCents).toBe(54310);
  });
  it('zero replacement and inclusive salary end stop earned wages', () => {
    const zero = annual(makePlan({ salaries: [salary({ annualGrossCents: 12000000, changes: [{ date: '2026-02-01', kind: 'amount', annualGrossCents: 0 }] })] }));
    expect(zero.annual.salaryCents).toBe(1000000);
    const ended = annual(makePlan({ salaries: [salary({ annualGrossCents: 12000000, endDate: '2026-01-15' })] }));
    expect(ended.annual.salaryCents).toBe(483871);
  });
  it('clamps scheduled payment dates and grows only after stream start', () => {
    const c = annual(makePlan({ startYear: 2027, otherIncome: [{ id: 'other', name: 'Other', amountCents: 10000, frequency: 'monthly', startDate: '2026-01-31', annualGrowthBps: 1000, classification: 'non-taxable' }], expenses: [{ id: 'expense', name: 'Expense', amountCents: 500, frequency: 'annual', startDate: '2024-02-29', annualGrowthBps: 0, use: 'personal', taxCategory: 'personal' }] }));
    expect(c.months.map(m => m.otherIncomeCents)).toEqual(Array(12).fill(11000));
    expect(c.months.map(m => m.expensesCents)).toEqual([42,41,42,42,41,42,42,41,42,42,41,42]);
    expect(c.annual.expensesCents).toBe(500);
    expect(c.annual.ordinaryTaxableCents).toBe(0);
    expect(c.annual.nonTaxableCents).toBe(132000);
  });
  it('budgets an annual expense monthly without replacing its saved annual amount', () => {
    const plan = mustValidate(makePlan({ expenses: [expense()] }));
    const c = resolveCashYear(plan, 2026);
    expect(c.months.map(m => m.expensesCents)).toEqual(Array(12).fill(10000));
    expect(c.annual.expensesCents).toBe(120000);
    expect(plan.expenses[0]).toMatchObject({ amountCents: 120000, frequency: 'annual' });
  });
  it.each([
    { amountCents: 100, expected: [8,9,8,8,9,8,8,9,8,8,9,8] },
    { amountCents: 13, expected: [1,1,1,1,1,2,1,1,1,1,1,1] },
  ])('preserves the annual $amountCents-cent expense with cumulative half-up settlement', ({ amountCents, expected }) => {
    const c = annual(makePlan({ expenses: [expense({ amountCents })] }));
    expect(c.months.map(m => m.expensesCents)).toEqual(expected);
    expect(c.annual.expensesCents).toBe(amountCents);
  });
  it('grows the annual expense budget on January 1 after its start year', () => {
    const plan = makePlan({ expenses: [expense({ startDate: '2026-06-15', annualGrowthBps: 1000 })] });
    expect(annual(plan).months.map(m => m.expensesCents)).toEqual([0,0,0,0,0,10000,10000,10000,10000,10000,10000,10000]);
    expect(annual(plan).annual.expensesCents).toBe(70000);
    expect(annual(plan, 2027).months.map(m => m.expensesCents)).toEqual(Array(12).fill(11000));
    expect(annual(plan, 2027).annual.expensesCents).toBe(132000);
  });
  it.each([
    { endDate: '2026-03-30', expected: [10000,10000,0,0,0,0,0,0,0,0,0,0], total: 20000 },
    { endDate: '2026-03-31', expected: [10000,10000,10000,0,0,0,0,0,0,0,0,0], total: 30000 },
  ])('retains the monthly start-day anchor and inclusive $endDate expense end', ({ endDate, expected, total }) => {
    const c = annual(makePlan({ expenses: [expense({ startDate: '2026-01-31', endDate })] }));
    expect(c.months.map(m => m.expensesCents)).toEqual(expected);
    expect(c.annual.expensesCents).toBe(total);
  });
  it('retains monthly expense amounts and annual other-income payment timing', () => {
    const plan = makePlan({
      expenses: [expense({ amountCents: 10000, frequency: 'monthly', startDate: '2026-02-15', endDate: '2026-04-14' })],
      otherIncome: [{ id: 'other', name: 'Annual cash income', amountCents: 120000, frequency: 'annual', startDate: '2026-06-15', annualGrowthBps: 1000, classification: 'non-taxable' }],
    });
    expect(annual(plan).months.map(m => m.expensesCents)).toEqual([0,10000,10000,0,0,0,0,0,0,0,0,0]);
    expect(annual(plan).months.map(m => m.otherIncomeCents)).toEqual([0,0,0,0,0,120000,0,0,0,0,0,0]);
    expect(annual(plan, 2027).months.map(m => m.otherIncomeCents)).toEqual([0,0,0,0,0,132000,0,0,0,0,0,0]);
  });
  it('aggregates other wage income by owner/employer without taxing nontaxable cash', () => {
    const c = annual(makePlan({ salaries: [salary()], otherIncome: [{ id: 'wage', name: 'Wage', amountCents: 100, frequency: 'monthly', startDate: '2026-01-01', annualGrowthBps: 0, classification: 'wage', ownerId: 'owner-a', employerId: 'employer-a' }] }));
    expect(c.wages).toHaveLength(1);
    expect(c.wages[0]!.annualCents).toBe(101201);
    expect(c.annual.wageCents).toBe(101201);
  });
  it('limits contribution percentages to intersecting earned days and fixed dates', () => {
    const p = makePlan({ salaries: [salary({ annualGrossCents: 12000000 })], accounts: [{ id: 'account', name: 'Brokerage', ownerId: 'owner-a', type: 'taxable-brokerage', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false } }], contributions: [{ id: 'percent', accountId: 'account', priority: 1, startDate: '2026-01-16', endDate: '2026-01-31', amount: { kind: 'salary-percent', salaryId: 'salary', percentBps: 1000 } }, { id: 'fixed', accountId: 'account', priority: 2, startDate: '2026-01-01', endDate: '2026-01-30', amount: { kind: 'fixed', monthlyCents: 20000 } }] });
    const r = requestContributions(mustValidate(p), annual(p));
    expect(r.find(x => x.ruleId === 'percent' && x.month === 1)?.requestedCents).toBe(51613);
    expect(r.filter(x => x.ruleId === 'fixed').reduce((s,x) => s + x.requestedCents,0)).toBe(0);
    expect(r.find(x => x.ruleId === 'percent' && x.month === 2)?.requestedCents).toBe(0);
  });
});
