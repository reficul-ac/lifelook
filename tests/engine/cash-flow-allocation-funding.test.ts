import { describe, expect, it } from 'vitest';
import { allocationFundingCeilings, scheduleAllocationFunding, settleAllocationTargets, type FundingTarget } from '../../src/engine/cash/allocation-funding';
import type { CashFlowAllocationEntry } from '../../src/engine/model/plan';
import { CalculationRangeError, MAX_CENTS } from '../../src/engine/money';

const months = Array.from({ length: 12 }, (_, i) => i + 1);
const row = (id: string, percentBps: number, priority = 1): CashFlowAllocationEntry => ({
  id, priority, destination: { kind: 'account', accountId: id }, amount: { kind: 'percent', percentBps },
});
const target = (ruleId: string, requestedCents: number, overrides: Partial<FundingTarget> = {}): FundingTarget => ({
  ruleId, requestedCents, stage: 'percent', priority: 1, allowedMonths: months, ...overrides,
});

describe('allocation percentage settlement', () => {
  it('uses the same annual total for two 50 percent destinations', () => {
    expect(settleAllocationTargets(10000000, [row('a', 5000), row('b', 5000)]))
      .toEqual([{ entryId: 'a', targetCents: 5000000 }, { entryId: 'b', targetCents: 5000000 }]);
  });
  it('settles 93 percent without percentage scaling drift', () => {
    expect(settleAllocationTargets(20000000, [row('a', 9300)]))
      .toEqual([{ entryId: 'a', targetCents: 18600000 }]);
  });
  it('distributes a shared fractional cent in stable priority and ID order', () => {
    const rows = [row('b', 5000), row('a', 5000)];
    expect(settleAllocationTargets(1, rows)).toEqual([{ entryId: 'a', targetCents: 1 }, { entryId: 'b', targetCents: 0 }]);
    expect(rows.map(r => r.id)).toEqual(['b', 'a']);
    expect(settleAllocationTargets(1, [row('a', 5000, 2), row('b', 5000, 1)]))
      .toEqual([{ entryId: 'b', targetCents: 1 }, { entryId: 'a', targetCents: 0 }]);
  });
  it('includes explicit cash percentages and excludes annual maximum rows', () => {
    expect(settleAllocationTargets(100, [
      { ...row('cash', 2500), destination: { kind: 'cash' } },
      { ...row('maximum', 0), amount: { kind: 'max-annual' } },
    ])).toEqual([{ entryId: 'cash', targetCents: 25 }]);
  });
  it.each([0, -100])('settles no new targets for nonpositive total %i', total => {
    expect(settleAllocationTargets(total, [row('a', 5000)])).toEqual([{ entryId: 'a', targetCents: 0 }]);
  });
  it('rejects totals outside the engine monetary range', () => {
    expect(() => settleAllocationTargets(MAX_CENTS + 1, [row('a', 5000)])).toThrow(CalculationRangeError);
  });
});

describe('allocation cumulative funding ceilings', () => {
  it('protects future expenses and explicit cash', () => {
    const cash = [10000, -8000, ...Array(10).fill(0)];
    expect(allocationFundingCeilings(cash, 500)).toEqual(Array(12).fill(1500));
  });
  it('does not borrow against later cash or spend opening reserves during a deficit', () => {
    expect(allocationFundingCeilings([-500, 1000, ...Array(10).fill(0)], 0))
      .toEqual([0, ...Array(11).fill(500)]);
  });
  it('caps cumulative funding at the annual total after explicit cash', () => {
    expect(allocationFundingCeilings([100, 200, ...Array(9).fill(0), 100], 150))
      .toEqual([100, ...Array(11).fill(250)]);
  });
  it('retains all available cash when the explicit cash target has a shortfall', () => {
    expect(allocationFundingCeilings([200, ...Array(11).fill(0)], 500)).toEqual(Array(12).fill(0));
    expect(allocationFundingCeilings([-200, ...Array(11).fill(0)], 500)).toEqual(Array(12).fill(0));
  });
  it('rejects cumulative overflow even when each month is in range', () => {
    expect(() => allocationFundingCeilings([MAX_CENTS, 1, ...Array(10).fill(0)], 0)).toThrow(CalculationRangeError);
  });
});

describe('allocation monthly funding', () => {
  it('spreads full-year percentage, maximum and overflow funding evenly across twelve months', () => {
    const schedule = scheduleAllocationFunding([
      target('primary', 1200),
      target('retirement', 600, { stage: 'max', employerKey: 'employer' }),
      target('excess', 360, { stage: 'overflow' }),
    ], Array.from({ length: 12 }, (_, i) => 180 * (i + 1)), [
      { key: 'employer', monthlyCents: Array(12).fill(100) },
    ]);
    expect([...schedule.fundedByRule]).toEqual([['primary', 1200], ['retirement', 600], ['excess', 360]]);
    expect(schedule.requestsByRule.get('primary')).toEqual(Array(12).fill(100));
    expect(schedule.requestsByRule.get('retirement')).toEqual(Array(12).fill(50));
    expect(schedule.requestsByRule.get('excess')).toEqual(Array(12).fill(30));
  });
  it('preserves the annual total while settling fractional monthly cents cumulatively', () => {
    const schedule = scheduleAllocationFunding([target('brokerage', 13)],
      Array.from({ length: 12 }, (_, i) => 2 * (i + 1)), []);
    expect(schedule.fundedByRule.get('brokerage')).toBe(13);
    expect(schedule.requestsByRule.get('brokerage')).toEqual([1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1]);
  });
  it('balances accepted partial annual funding rather than the unfunded requested target', () => {
    const schedule = scheduleAllocationFunding([
      target('primary', 240), target('excess', 60, { stage: 'overflow' }),
    ], Array.from({ length: 12 }, (_, i) => 10 * (i + 1)), []);
    expect([...schedule.fundedByRule]).toEqual([['primary', 120], ['excess', 0]]);
    expect(schedule.requestsByRule.get('primary')).toEqual(Array(12).fill(10));
    expect(schedule.requestsByRule.get('excess')).toEqual(Array(12).fill(0));
  });
  it('moves flexible brokerage funding later to preserve an early payroll window', () => {
    const schedule = scheduleAllocationFunding([
      target('brokerage', 100, { allowedMonths: [1, 12] }),
      target('retirement', 100, { stage: 'max', allowedMonths: [1], employerKey: 'employer' }),
    ], [100, ...Array(10).fill(100), 200], [{ key: 'employer', monthlyCents: [100, ...Array(11).fill(0)] }]);
    expect([...schedule.fundedByRule]).toEqual([['brokerage', 100], ['retirement', 100]]);
    expect(schedule.requestsByRule.get('brokerage')).toEqual([...Array(11).fill(0), 100]);
    expect(schedule.requestsByRule.get('retirement')).toEqual([100, ...Array(11).fill(0)]);
  });
  it('reroutes an earlier target out of a later constrained target month', () => {
    const schedule = scheduleAllocationFunding([
      target('flexible', 100, { allowedMonths: [1, 2], employerKey: 'employer' }),
      target('constrained', 100, { stage: 'max', allowedMonths: [2], employerKey: 'employer' }),
    ], [100, ...Array(11).fill(200)], [{ key: 'employer', monthlyCents: [100, 100, ...Array(10).fill(0)] }]);
    expect([...schedule.fundedByRule]).toEqual([['flexible', 100], ['constrained', 100]]);
    expect(schedule.requestsByRule.get('flexible')).toEqual([100, ...Array(11).fill(0)]);
    expect(schedule.requestsByRule.get('constrained')).toEqual([0, 100, ...Array(10).fill(0)]);
  });
  it('preserves stage priority before numeric priority and stable IDs', () => {
    const schedule = scheduleAllocationFunding([
      target('overflow', 100, { stage: 'overflow', priority: 0 }),
      target('max-b', 60, { stage: 'max', priority: 0 }),
      target('percent', 60, { priority: 99 }),
      target('max-a', 30, { stage: 'max', priority: 0 }),
    ], Array(12).fill(100), []);
    expect([...schedule.fundedByRule]).toEqual([['percent', 60], ['max-a', 30], ['max-b', 10], ['overflow', 0]]);
  });
  it('shares sponsoring monthly wages across targets while keeping employers independent', () => {
    const schedule = scheduleAllocationFunding([
      target('first', 80, { allowedMonths: [1], employerKey: 'a' }),
      target('second', 80, { priority: 2, allowedMonths: [1], employerKey: 'a' }),
      target('third', 80, { priority: 3, allowedMonths: [1], employerKey: 'b' }),
    ], Array(12).fill(500), [
      { key: 'a', monthlyCents: [100, ...Array(11).fill(0)] },
      { key: 'b', monthlyCents: [80, ...Array(11).fill(0)] },
    ]);
    expect([...schedule.fundedByRule]).toEqual([['first', 80], ['second', 20], ['third', 80]]);
    expect(schedule.requestsByRule.get('second')).toEqual([20, ...Array(11).fill(0)]);
  });
  it('cannot fund an ended salary with cash arriving later', () => {
    const schedule = scheduleAllocationFunding([
      target('retirement', 100, { allowedMonths: [1], employerKey: 'ended' }),
      target('brokerage', 100, { stage: 'overflow' }),
    ], [0, ...Array(11).fill(100)], [{ key: 'ended', monthlyCents: [100, ...Array(11).fill(0)] }]);
    expect([...schedule.fundedByRule]).toEqual([['retirement', 0], ['brokerage', 100]]);
    expect(schedule.requestsByRule.get('retirement')).toEqual(Array(12).fill(0));
  });
  it('enforces every cumulative ceiling, including the annual ceiling', () => {
    const schedule = scheduleAllocationFunding([
      target('january', 100, { allowedMonths: [1] }),
      target('february', 100, { priority: 2, allowedMonths: [2] }),
      target('december', 100, { priority: 3, allowedMonths: [12] }),
    ], [30, ...Array(10).fill(50), 90], []);
    expect([...schedule.fundedByRule]).toEqual([['january', 30], ['february', 20], ['december', 40]]);
  });
  it('does not create wage capacity for an absent employer or months outside eligibility', () => {
    const schedule = scheduleAllocationFunding([
      target('missing', 100, { employerKey: 'missing' }), target('inactive', 100, { allowedMonths: [] }),
    ], Array(12).fill(100), []);
    expect([...schedule.fundedByRule]).toEqual([['inactive', 0], ['missing', 0]]);
  });
  it('is deterministic with unsorted inputs and does not mutate frozen input arrays', () => {
    const a = Object.freeze(target('a', 20, { allowedMonths: Object.freeze([12, 1, 12]) }));
    const b = Object.freeze(target('b', 20));
    const ceilings = Object.freeze(Array(12).fill(30));
    const employers = Object.freeze([]);
    expect(scheduleAllocationFunding(Object.freeze([b, a]), ceilings, employers))
      .toEqual(scheduleAllocationFunding(Object.freeze([a, b]), ceilings, employers));
  });
  it('rejects requested amounts beyond the supported monetary range', () => {
    expect(() => scheduleAllocationFunding([target('a', MAX_CENTS + 1)], Array(12).fill(1), []))
      .toThrow(CalculationRangeError);
  });
});

describe('funding input boundaries', () => {
  it.each([
    ['short cash year', () => allocationFundingCeilings([100], 0)],
    ['fractional cents', () => allocationFundingCeilings([0.5, ...Array(11).fill(0)], 0)],
    ['negative explicit cash', () => allocationFundingCeilings(Array(12).fill(0), -1)],
    ['explicit cash overflow', () => allocationFundingCeilings(Array(12).fill(0), MAX_CENTS + 1)],
    ['short ceiling year', () => scheduleAllocationFunding([], [100], [])],
    ['decreasing ceiling', () => scheduleAllocationFunding([], [100, ...Array(11).fill(50)], [])],
    ['negative request', () => scheduleAllocationFunding([target('a', -1)], Array(12).fill(100), [])],
    ['invalid month', () => scheduleAllocationFunding([target('a', 1, { allowedMonths: [0] })], Array(12).fill(100), [])],
    ['duplicate rule ID', () => scheduleAllocationFunding([target('a', 1), target('a', 2)], Array(12).fill(100), [])],
    ['duplicate employer key', () => scheduleAllocationFunding([], Array(12).fill(100), [
      { key: 'a', monthlyCents: Array(12).fill(100) }, { key: 'a', monthlyCents: Array(12).fill(100) },
    ])],
    ['short employer year', () => scheduleAllocationFunding([], Array(12).fill(100), [{ key: 'a', monthlyCents: [100] }])],
    ['negative wage capacity', () => scheduleAllocationFunding([], Array(12).fill(100), [{ key: 'a', monthlyCents: Array(12).fill(-1) }])],
  ] as const)('rejects %s instead of silently misfunding a target', (_name, action) => {
    expect(action).toThrow(RangeError);
  });
});
