import { describe, expect, it } from 'vitest';
import { Decimal, MAX_CENTS } from '../../src/engine/money';
import type { Available } from '../../src/engine/model/results';
import {
  solveBrokerageFunding,
  type BrokerageFundingAccount,
  type BrokerageFundingEvaluation,
  type BrokerageFundingEvent,
  type BrokerageSale,
} from '../../src/engine/cash/brokerage-funding';

const available = <T>(value: T): Available<T> => ({ status: 'available', value });
const value = <T>(result: Available<T>): T => {
  if (result.status !== 'available') throw new Error(JSON.stringify(result.issues));
  return result.value;
};
const account = (openingCents: number, openingBasisCents: number, accountId = 'brokerage'): BrokerageFundingAccount =>
  ({ accountId, openingExact: new Decimal(openingCents), openingBasisCents, annualGrowthBps: 0 });
const event = (constructionCents: number, id = 'stage', date = '2027-01-15', accountId = 'brokerage'): BrokerageFundingEvent =>
  ({ id, projectId: 'project', propertyId: 'property', accountId, date, constructionCents });

function evaluate(sales: readonly BrokerageSale[]): Available<BrokerageFundingEvaluation<string>> {
  return available({
    payload: 'household', contributions: [],
    taxes: sales.map(sale => ({ eventId: sale.id, federalTaxCents: 0, californiaTaxCents: 0 })),
  });
}

describe('annual brokerage construction funding ledger', () => {
  it('omits zero owner cash stages and preserves a known zero basis', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(1000, 0)], events: [event(0, 'none'), event(200)], evaluate }));
    expect(result.sales).toEqual([{
      ...event(200), grossSaleCents: 200, basisConsumedCents: 0, realizedGainCents: 200,
      federalTaxCents: 0, californiaTaxCents: 0, constructionFundedCents: 200, shortfallCents: 0, residualCents: 0,
    }]);
    expect(result.accounts[0]!.months[0]).toMatchObject({ openingCents: 1000, grossSaleCents: 200, closingCents: 800, closingBasisCents: 0 });
    expect(result.evaluation.payload).toBe('household');
  });

  it('consumes proportional basis and records losses without inventing loss offsets', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(1000, 1500)], events: [event(400)], evaluate }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 400, basisConsumedCents: 600, realizedGainCents: -200 });
    expect(result.accounts[0]).toMatchObject({ closingBasisCents: 900 });
  });

  it('retains nonzero basis in a zero value account and reports the funding shortfall', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(0, 500)], events: [event(200)], evaluate }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 0, basisConsumedCents: 0, realizedGainCents: 0, constructionFundedCents: 0, shortfallCents: 200 });
    expect(result.accounts[0]!.closingBasisCents).toBe(500);
    expect(result.accounts[0]!.closingExact.toNumber()).toBe(0);
  });

  it('consumes all remaining basis on full liquidation and caps an insufficient account', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(1000, 333)], events: [event(2000)], evaluate }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 1000, basisConsumedCents: 333, realizedGainCents: 667, constructionFundedCents: 1000, shortfallCents: 1000 });
    expect(result.accounts[0]!.closingBasisCents).toBe(0);
    expect(result.accounts[0]!.closingExact.toNumber()).toBe(0);
  });

  it('sells enough to pay the tax on the additional sale itself', () => {
    const tax = (sales: readonly BrokerageSale[]) => available({
      payload: 'taxed', contributions: [], taxes: sales.map(sale => ({ eventId: sale.id,
        federalTaxCents: Math.round(Math.max(0, sale.realizedGainCents) * .2),
        californiaTaxCents: Math.round(Math.max(0, sale.realizedGainCents) * .1) })),
    });
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(5000, 0)], events: [event(1000)], evaluate: tax }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 1429, realizedGainCents: 1429,
      federalTaxCents: 286, californiaTaxCents: 143, constructionFundedCents: 1000, shortfallCents: 0, residualCents: 0 });
    expect(result.accounts[0]!.months[0]).toMatchObject({ grossSaleCents: 1429, closingCents: 3571 });
  });

  it('grosses up only the gain from the proportionally consumed basis', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(1000, 500)], events: [event(400)],
      evaluate: sales => available({ payload: 1, contributions: [], taxes: sales.map(sale => ({ eventId: sale.id,
        federalTaxCents: Math.round(Math.max(0, sale.realizedGainCents) * .2), californiaTaxCents: 0 })) }) }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 444, basisConsumedCents: 222, realizedGainCents: 222, federalTaxCents: 44 });
  });

  it('uses authoritative nonlinear tax thresholds instead of a fixed tax rate', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(5000, 0)], events: [event(1100)],
      evaluate: sales => available({ payload: 'threshold', contributions: [], taxes: sales.map(sale => ({ eventId: sale.id,
        federalTaxCents: sale.realizedGainCents <= 1000 ? Math.round(sale.realizedGainCents * .2)
          : 200 + Math.round((sale.realizedGainCents - 1000) * .5), californiaTaxCents: 0 })) }) }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 1600, federalTaxCents: 500, constructionFundedCents: 1100, residualCents: 0 });
  });

  it('finds the first covering cent when whole-dollar tax rounding creates separated covering intervals', () => {
    // At 9,600 cents the tax is 8,600; every lower candidate has net proceeds
    // below 1,000. Later rounding steps create more covering intervals.
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(50000, 0)], events: [event(1000)],
      evaluate: sales => available({ payload: 'dollar rounding', contributions: [], taxes: sales.map(sale => ({ eventId: sale.id,
        federalTaxCents: Math.round(sale.realizedGainCents * .009) * 100, californiaTaxCents: 0 })) }) }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 9600, federalTaxCents: 8600, constructionFundedCents: 1000 });
  });

  it('preserves signed jurisdiction tax deltas, including a net refund', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(1000, 0)], events: [event(200)],
      evaluate: sales => available({ payload: 'refund', contributions: [], taxes: sales.map(sale => ({ eventId: sale.id,
        federalTaxCents: sale.realizedGainCents > 0 ? 30 : 0, californiaTaxCents: sale.realizedGainCents > 0 ? -50 : 0 })) }) }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 180, federalTaxCents: 30, californiaTaxCents: -50, constructionFundedCents: 200 });
  });

  it('reconciles shared-account stages with accepted deposits after each month’s sales', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(1000, 500)],
      events: [event(200, 'later', '2027-02-15'), event(400, 'first')],
      evaluate: sales => available({ ...value(evaluate(sales)), contributions: [
        { accountId: 'brokerage', month: 1, amountCents: 100 }, { accountId: 'brokerage', month: 1, amountCents: 100 },
      ] }) }));
    expect(result.sales.map(sale => [sale.id, sale.grossSaleCents, sale.basisConsumedCents, sale.realizedGainCents]))
      .toEqual([['first', 400, 200, 200], ['later', 200, 125, 75]]);
    expect(result.accounts[0]!.months[0]).toMatchObject({ contributionCents: 200, closingCents: 800, closingBasisCents: 500 });
    expect(result.accounts[0]!.months[1]).toMatchObject({ openingCents: 800, closingCents: 600, closingBasisCents: 375 });
  });

  it('grows before sales and leaves basis unchanged by appreciation', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [{ ...account(1000, 500), annualGrowthBps: 10000 }],
      events: [event(59), event(272, 'february', '2027-02-15')],
      evaluate: sales => available({ ...value(evaluate(sales)), contributions: [{ accountId: 'brokerage', month: 1, amountCents: 200 }] }) }));
    expect(result.accounts[0]!.months[0]).toMatchObject({ growthCents: 59, grossSaleCents: 59, contributionCents: 200, closingCents: 1200, basisConsumedCents: 28, closingBasisCents: 672 });
    expect(result.accounts[0]!.months[1]).toMatchObject({ openingCents: 1200, growthCents: 72, grossSaleCents: 272, closingCents: 1000, basisConsumedCents: 144, closingBasisCents: 528 });
  });

  it('orders same-day shared-account basis consumption by stable event ID', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(1000, 333)], events: [event(500, 'b'), event(500, 'a')], evaluate }));
    expect(result.sales.map(sale => [sale.id, sale.basisConsumedCents])).toEqual([['a', 167], ['b', 166]]);
  });

  it('does not borrow from later deposits or consume another account’s holdings', () => {
    const result = value(solveBrokerageFunding({ year: 2027, accounts: [account(100, 20), account(10000, 10000, 'other')], events: [event(200)],
      evaluate: sales => available({ ...value(evaluate(sales)), contributions: [{ accountId: 'brokerage', month: 1, amountCents: 1000 }] }) }));
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 100, basisConsumedCents: 20, shortfallCents: 100 });
    expect(result.accounts.find(row => row.accountId === 'brokerage')).toMatchObject({ closingBasisCents: 1000 });
    expect(result.accounts.find(row => row.accountId === 'other')!.closingExact.toNumber()).toBe(10000);
  });

  it('does not mutate inputs or previously evaluated sale snapshots', () => {
    const accounts = Object.freeze([Object.freeze(account(1000, 500))]);
    const events = Object.freeze([Object.freeze(event(200))]);
    const snapshots: { rows: readonly BrokerageSale[]; before: string }[] = [];
    const result = value(solveBrokerageFunding({ year: 2027, accounts, events,
      evaluate: sales => {
        snapshots.push({ rows: sales, before: JSON.stringify(sales) });
        return evaluate(sales);
      } }));
    expect(accounts[0]!.openingExact.toNumber()).toBe(1000);
    expect(events[0]!.constructionCents).toBe(200);
    expect(result.sales[0]).toMatchObject({ grossSaleCents: 200, basisConsumedCents: 100 });
    for (const snapshot of snapshots) expect(JSON.stringify(snapshot.rows)).toBe(snapshot.before);
  });

  it('reports a contribution feedback cycle with a specific issue', () => {
    const result = solveBrokerageFunding({ year: 2027, accounts: [account(100, 0)], events: [event(150, 'stage', '2027-02-15')],
      evaluate: sales => available({ ...value(evaluate(sales)), contributions: [{ accountId: 'brokerage', month: 1,
        amountCents: sales[0]!.grossSaleCents < 150 ? 100 : 0 }] }) });
    expect(result.status).toBe('needs-data');
    if (result.status !== 'available') expect(result.issues.map(issue => issue.code)).toContain('brokerage-funding-cycle');
  });

  it('bounds optional schedule work without changing the default verified result', () => {
    const input = { year: 2027, accounts: [account(1000, 500)], events: [event(200)],
      evaluate: (sales: readonly BrokerageSale[]) => available({ ...value(evaluate(sales)),
        contributions: [{ accountId: 'brokerage', month: 12, amountCents: 100 }] }) };
    expect(solveBrokerageFunding(input).status).toBe('available');
    const limited = solveBrokerageFunding({ ...input, maxScheduleIterations: 1 });
    expect(limited.status).toBe('needs-data');
    if (limited.status !== 'available') expect(limited.issues.map(issue => issue.code)).toContain('brokerage-funding-nonconvergence');
    for (const maxScheduleIterations of [0, 65, 1.5]) {
      const invalid = solveBrokerageFunding({ ...input, maxScheduleIterations });
      expect(invalid.status).toBe('needs-data');
      if (invalid.status !== 'available') expect(invalid.issues.map(issue => issue.code)).toContain('invalid-brokerage-funding-input');
    }
  });

  it('propagates unavailable authoritative tax results and reports overflow', () => {
    const unavailable: Available<BrokerageFundingEvaluation<string>> = { status: 'unsupported-case', issues: [{ code: 'unavailable-tax', severity: 'warning', explanation: 'Missing history', resolution: 'Enter history' }] };
    expect(solveBrokerageFunding({ year: 2027, accounts: [], events: [], evaluate: () => unavailable })).toEqual(unavailable);
    const result = solveBrokerageFunding({ year: 2027, accounts: [{ ...account(MAX_CENTS, 0), annualGrowthBps: 10000 }], events: [], evaluate });
    expect(result.status).toBe('needs-data');
    if (result.status !== 'available') expect(result.issues.map(issue => issue.code)).toContain('monetary-overflow');
  });
});
