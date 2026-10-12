import { describe, expect, it } from 'vitest';
import { resolveCashYear } from '../../src/engine/cash/income';
import { requestContributions } from '../../src/engine/cash/contribution-requests';
import { makePlan, mustValidate } from '../helpers/plans';
import type { Salary } from '../../src/engine/model/plan';
import type { CashYear } from '../../src/engine/cash/income';
import type { PlanDocument } from '../../src/engine/model/plan';
import { loadReferences } from '../helpers/references';

const salary = (o: Partial<Salary> = {}): Salary => ({ id: 'salary', name: 'Salary', ownerId: 'owner-a', employerId: 'employer-a', annualGrossCents: 100001, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [], ...o });
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
  it('zero replacement and inclusive salary end stop earned wages', () => {
    const zero = annual(makePlan({ salaries: [salary({ annualGrossCents: 12000000, changes: [{ date: '2026-02-01', kind: 'amount', annualGrossCents: 0 }] })] }));
    expect(zero.annual.salaryCents).toBe(1000000);
    const ended = annual(makePlan({ salaries: [salary({ annualGrossCents: 12000000, endDate: '2026-01-15' })] }));
    expect(ended.annual.salaryCents).toBe(483871);
  });
  it('clamps scheduled payment dates and grows only after stream start', () => {
    const c = annual(makePlan({ startYear: 2027, otherIncome: [{ id: 'other', name: 'Other', amountCents: 10000, frequency: 'monthly', startDate: '2026-01-31', annualGrowthBps: 1000, classification: 'non-taxable' }], expenses: [{ id: 'expense', name: 'Expense', amountCents: 500, frequency: 'annual', startDate: '2024-02-29', annualGrowthBps: 0, use: 'personal', taxCategory: 'personal' }] }));
    expect(c.months.map(m => m.otherIncomeCents)).toEqual(Array(12).fill(11000));
    expect(c.months[1]!.expensesCents).toBe(500);
    expect(c.annual.expensesCents).toBe(500);
    expect(c.annual.ordinaryTaxableCents).toBe(0);
    expect(c.annual.nonTaxableCents).toBe(132000);
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
