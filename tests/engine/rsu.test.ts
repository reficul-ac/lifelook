import { describe, expect, it } from 'vitest';
import type { Account, RsuGrant } from '../../src/engine/model/plan';
import { CalculationRangeError, MAX_CENTS } from '../../src/engine/money';
import { projectRsuAccounts, rsuVestingEvents, type RsuGrantMonth } from '../../src/engine/equity/rsu';
import { makePlan } from '../helpers/plans';

function grant(overrides: Partial<RsuGrant> = {}): RsuGrant {
  return {
    id: 'initial', name: 'Initial grant', startDate: '2026-01-01',
    grantValueCents: 120000, grantSharePriceCents: 1000,
    vestingMonths: 12, vestingFrequency: 'monthly', cliffMonths: 0,
    withholdingBps: 2500, taxTreatment: 'settle-at-vest',
    openingHeldShares: 0, openingBasis: { known: true, value: 0 },
    ...overrides,
  };
}

function account(grants: readonly RsuGrant[], overrides: Partial<Account> = {}): Account {
  return {
    id: 'employer-stock', name: 'Employer stock', ownerId: 'owner-a', type: 'rsu',
    openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false },
    rsu: { employerId: 'employer', currentSharePriceCents: 1000, grants },
    ...overrides,
  };
}

function row(rows: readonly RsuGrantMonth[], month: number, year = 2026, grantId = 'initial'): RsuGrantMonth {
  const result = rows.find(value => value.year === year && value.month === month && value.grantId === grantId);
  if (!result) throw new Error('Missing RSU grant month');
  return result;
}

describe('independent RSU vesting dates and quantities', () => {
  it.each([
    { frequency: 'monthly' as const, dates: ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'], shares: 10 },
    { frequency: 'quarterly' as const, dates: ['2026-04-01', '2026-07-01', '2026-10-01', '2027-01-01'], shares: 30 },
    { frequency: 'annual' as const, dates: ['2027-01-01'], shares: 120 },
  ])('vests $frequency after its first interval', ({ frequency, dates, shares }) => {
    expect(rsuVestingEvents(grant({ vestingFrequency: frequency }))).toEqual(dates.map(date => ({ date, shares })));
  });

  it('catches up a twelve-month cliff before resuming the original monthly schedule', () => {
    const events = rsuVestingEvents(grant({ vestingMonths: 48, cliffMonths: 12, grantValueCents: 480000 }));
    expect(events[0]).toEqual({ date: '2027-01-01', shares: 120 });
    expect(events[1]).toEqual({ date: '2027-02-01', shares: 10 });
    expect(events.at(-1)).toEqual({ date: '2030-01-01', shares: 10 });
    expect(events).toHaveLength(37);
    expect(events.reduce((sum, event) => sum + event.shares, 0)).toBe(480);
  });

  it('vests an off-cycle cliff on its own date and catches up to the next regular interval', () => {
    expect(rsuVestingEvents(grant({ vestingFrequency: 'quarterly', cliffMonths: 2 }))).toEqual([
      { date: '2026-03-01', shares: 20 }, { date: '2026-04-01', shares: 10 },
      { date: '2026-07-01', shares: 30 }, { date: '2026-10-01', shares: 30 },
      { date: '2027-01-01', shares: 30 },
    ]);
  });

  it('completes a fourteen-month quarterly term with a final partial interval', () => {
    expect(rsuVestingEvents(grant({ vestingMonths: 14, vestingFrequency: 'quarterly', grantValueCents: 140000 }))).toEqual([
      { date: '2026-04-01', shares: 30 }, { date: '2026-07-01', shares: 30 },
      { date: '2026-10-01', shares: 30 }, { date: '2027-01-01', shares: 30 },
      { date: '2027-03-01', shares: 20 },
    ]);
  });

  it('anchors month-end dates to the original day through leap February', () => {
    expect(rsuVestingEvents(grant({ startDate: '2024-01-31', vestingMonths: 3, grantValueCents: 3000 }))).toEqual([
      { date: '2024-02-29', shares: 1 }, { date: '2024-03-31', shares: 1 },
      { date: '2024-04-30', shares: 1 },
    ]);
    expect(rsuVestingEvents(grant({ startDate: '2024-02-29', vestingMonths: 24, vestingFrequency: 'annual' }))).toEqual([
      { date: '2025-02-28', shares: 60 }, { date: '2026-02-28', shares: 60 },
    ]);
  });

  it('uses an actual awarded-share override instead of repricing the award', () => {
    const events = rsuVestingEvents(grant({ awardedShares: 12.000006, vestingFrequency: 'quarterly' }));
    expect(events.map(event => event.shares)).toEqual([3.0000015, 3.0000015, 3.0000015, 3.0000015]);
  });

  it('preserves a fractional award through cumulative Decimal quantities', () => {
    const events = rsuVestingEvents(grant({ grantValueCents: 100, grantSharePriceCents: 3, vestingMonths: 7 }));
    expect(events).toHaveLength(7);
    expect(events[0]!.shares).toBeCloseTo(4.761904761904762, 14);
    expect(events.reduce((sum, event) => sum + event.shares, 0)).toBeCloseTo(33.333333333333336, 13);
  });
});

describe('RSU share holdings, compensation and valuation', () => {
  it('never taxes or holds an award when the grant is created', () => {
    const result = projectRsuAccounts(makePlan({ accounts: [account([grant()])] }));
    expect(result.issues).toEqual([]);
    expect(row(result.months, 1)).toEqual({
      accountId: 'employer-stock', grantId: 'initial', year: 2026, month: 1,
      openingValueCents: 0, growthCents: 0, vestedShares: 0, withheldShares: 0,
      heldShares: 0, unvestedShares: 120, unsettledShares: 0,
      vestedValueCents: 0, taxableIncomeCents: 0, withholdingCents: 0,
      closingValueCents: 0, unvestedValueCents: 120000, basis: { known: true, value: 0 },
    });
    expect(row(result.months, 2)).toMatchObject({
      vestedShares: 10, withheldShares: 2.5, heldShares: 7.5, unvestedShares: 110,
      vestedValueCents: 10000, taxableIncomeCents: 10000, withholdingCents: 2500,
      closingValueCents: 7500, basis: { known: true, value: 7500 },
    });
    expect(row(result.months, 12)).toMatchObject({ heldShares: 82.5, unvestedShares: 10, closingValueCents: 82500 });
  });

  it('keeps two overlapping grants independent in the same account', () => {
    const result = projectRsuAccounts(makePlan({ accounts: [account([
      grant(), grant({ id: 'refresher', name: 'Refresher', startDate: '2026-04-01', grantValueCents: 48000, grantSharePriceCents: 2000, vestingMonths: 6, withholdingBps: 0 }),
    ])] }));
    expect(result.months).toHaveLength(24);
    expect(row(result.months, 5)).toMatchObject({ vestedShares: 10, heldShares: 30, unvestedShares: 80 });
    expect(row(result.months, 5, 2026, 'refresher')).toMatchObject({ vestedShares: 4, heldShares: 4, unvestedShares: 20, taxableIncomeCents: 4000 });
    expect(row(result.months, 12, 2026, 'refresher')).toMatchObject({ heldShares: 24, unvestedShares: 0, taxableIncomeCents: 0 });
  });

  it('skips prior vests and uses actual opening holdings without reconstructing them', () => {
    const result = projectRsuAccounts(makePlan({ accounts: [account([grant({
      startDate: '2025-01-01', vestingMonths: 24, grantValueCents: 240000,
      openingHeldShares: 4, openingBasis: { known: true, value: 3500 },
    })])] }));
    expect(row(result.months, 1)).toMatchObject({
      openingValueCents: 4000, vestedShares: 10, heldShares: 11.5, unvestedShares: 120,
      taxableIncomeCents: 10000, withholdingCents: 2500, closingValueCents: 11500,
      basis: { known: true, value: 11000 },
    });
    expect(row(result.months, 12)).toMatchObject({ heldShares: 94, unvestedShares: 10, taxableIncomeCents: 10000 });
  });

  it('retains only entered holdings after a fully preforecast grant has vested', () => {
    const result = projectRsuAccounts(makePlan({ accounts: [account([grant({ startDate: '2024-01-01', openingHeldShares: 3, openingBasis: { known: false } })])] }));
    expect(result.months.every(value => value.taxableIncomeCents === 0 && value.heldShares === 3 && value.unvestedShares === 0)).toBe(true);
    expect(row(result.months, 12)).toMatchObject({ closingValueCents: 3000, basis: { known: false } });
  });

  it('includes a January first final vest only in the next forecast year', () => {
    const result = projectRsuAccounts(makePlan({ horizonYears: 2, accounts: [account([grant()])] }));
    expect(result.months.filter(value => value.year === 2026).reduce((sum, value) => sum + value.taxableIncomeCents, 0)).toBe(110000);
    expect(row(result.months, 1, 2027)).toMatchObject({ vestedShares: 10, heldShares: 90, unvestedShares: 0, taxableIncomeCents: 10000 });
    expect(row(result.months, 2, 2027)).toMatchObject({ vestedShares: 0, taxableIncomeCents: 0 });
  });

  it('values event delivery with elapsed whole months and the fraction of its month', () => {
    // A 100% effective annual increase: July 16 is 6 + 15/31 months from January 1.
    // Ten shares at 1000 * 2^((6 + 15/31)/12) = 14542.9766 cents.
    // August 1 value is 10000 * 2^(7/12) = 14983.0708 cents.
    const result = projectRsuAccounts(makePlan({ accounts: [account([grant({
      startDate: '2026-06-16', vestingMonths: 1, grantValueCents: 10000, withholdingBps: 2500,
    })], { annualGrowthBps: 10000 })] }));
    expect(row(result.months, 7)).toMatchObject({
      vestedShares: 10, withheldShares: 2.5, heldShares: 7.5,
      vestedValueCents: 14543, taxableIncomeCents: 14543, withholdingCents: 3636,
      closingValueCents: 11237, growthCents: 330, basis: { known: true, value: 10907 },
    });
    expect(row(result.months, 12)).toMatchObject({ closingValueCents: 15000, basis: { known: true, value: 10907 } });
  });

  it('grows the forecast price before a future grant starts without changing awarded units', () => {
    const result = projectRsuAccounts(makePlan({ horizonYears: 3, accounts: [account([grant({
      startDate: '2027-12-01', vestingMonths: 1, grantValueCents: 10000, withholdingBps: 0,
    })], { annualGrowthBps: 10000 })] }));
    expect(row(result.months, 11, 2027)).toMatchObject({ unvestedShares: 0, unvestedValueCents: 0 });
    expect(row(result.months, 12, 2027)).toMatchObject({ unvestedShares: 10, unvestedValueCents: 40000 });
    expect(row(result.months, 1, 2028)).toMatchObject({ vestedShares: 10, taxableIncomeCents: 40000 });
    expect(row(result.months, 12, 2028)).toMatchObject({ heldShares: 10, closingValueCents: 80000 });
  });

  it.each([
    { withholdingBps: 0, withheldShares: 0, heldShares: 10, withholdingCents: 0, closingValueCents: 10000 },
    { withholdingBps: 10000, withheldShares: 10, heldShares: 0, withholdingCents: 10000, closingValueCents: 0 },
  ])('handles $withholdingBps basis-point sell-to-cover without losing compensation', expected => {
    const result = projectRsuAccounts(makePlan({ accounts: [account([grant({ withholdingBps: expected.withholdingBps })])] }));
    expect(row(result.months, 2)).toMatchObject({
      taxableIncomeCents: 10000, withheldShares: expected.withheldShares,
      heldShares: expected.heldShares, withholdingCents: expected.withholdingCents,
      closingValueCents: expected.closingValueCents, basis: { known: true, value: expected.closingValueCents },
    });
  });

  it('reports declining held and unvested values separately from units and known basis', () => {
    const result = projectRsuAccounts(makePlan({ accounts: [account([
      grant({ startDate: '2024-01-01', openingHeldShares: 10, openingBasis: { known: true, value: 7000 } }),
      grant({ id: 'future', vestingFrequency: 'annual' }),
    ], { annualGrowthBps: -5000 })] }));
    expect(row(result.months, 12)).toMatchObject({ heldShares: 10, unvestedShares: 0, closingValueCents: 5000, basis: { known: true, value: 7000 } });
    expect(row(result.months, 12, 2026, 'future')).toMatchObject({ heldShares: 0, unvestedShares: 120, closingValueCents: 0, unvestedValueCents: 60000 });
    expect(result.months.reduce((sum, value) => sum + value.growthCents, 0)).toBe(-5000);
  });

  it('carries exact fractional shares and rounded money across a fully vested award', () => {
    const fractional = grant({
      grantValueCents: 100, grantSharePriceCents: 3, vestingMonths: 7, withholdingBps: 3333,
    });
    const result = projectRsuAccounts(makePlan({ horizonYears: 2, accounts: [account([fractional], {
      rsu: { employerId: 'employer', currentSharePriceCents: 3, grants: [fractional] },
    })] }));
    expect(row(result.months, 12)).toMatchObject({ unvestedShares: 0, closingValueCents: 67, basis: { known: true, value: 67 } });
    expect(row(result.months, 12).heldShares).toBeCloseTo(22.223333333333333, 12);
    expect(result.months.reduce((sum, value) => sum + value.taxableIncomeCents, 0)).toBe(100);
    expect(result.months.reduce((sum, value) => sum + value.withholdingCents, 0)).toBe(33);
    for (const value of result.months) {
      expect(value.closingValueCents - value.openingValueCents).toBe(value.growthCents + value.vestedValueCents - value.withholdingCents);
    }
  });

  it('keeps unknown basis explicit without hiding held asset forecasts', () => {
    const result = projectRsuAccounts(makePlan({ accounts: [account([grant({ openingBasis: { known: false } })])] }));
    expect(row(result.months, 2)).toMatchObject({ closingValueCents: 7500, basis: { known: false } });
    expect(result.issues).toEqual([]);
  });

  it('shows deferred service vesting and all unsettled units while blocking tax timing', () => {
    const result = projectRsuAccounts(makePlan({ accounts: [account([
      grant(), grant({ id: 'deferred', startDate: '2025-01-01', vestingMonths: 24, grantValueCents: 240000, taxTreatment: 'deferred' }),
    ])] }));
    expect(row(result.months, 1, 2026, 'deferred')).toMatchObject({
      vestedShares: 10, withheldShares: 0, heldShares: 0, unvestedShares: 120, unsettledShares: 120,
      vestedValueCents: 10000, taxableIncomeCents: 0, withholdingCents: 0,
      closingValueCents: 0, basis: { known: true, value: 0 },
    });
    expect(row(result.months, 12, 2026, 'deferred')).toMatchObject({ unsettledShares: 230, unvestedShares: 10 });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'unsupported-rsu-deferred-settlement', recordId: 'employer-stock', year: 2026, field: 'rsu.grants.1.taxTreatment',
    }));
  });

  it('limits deferred tax warnings to years with vested unsettled service units', () => {
    const result = projectRsuAccounts(makePlan({ horizonYears: 4, accounts: [account([grant({
      taxTreatment: 'deferred', startDate: '2027-12-01', vestingFrequency: 'annual',
    })])] }));
    expect(result.issues.map(issue => issue.year)).toEqual([2028, 2029]);
    expect(row(result.months, 12, 2027)).toMatchObject({ vestedShares: 0, unsettledShares: 0, unvestedShares: 120 });
    expect(row(result.months, 12, 2028)).toMatchObject({ vestedShares: 120, unsettledShares: 120, unvestedShares: 0 });
  });

  it('values December at the next opening price at the last supported calendar year', () => {
    const result = projectRsuAccounts(makePlan({ startYear: 9999, accounts: [account([grant({
      startDate: '9997-01-01', openingHeldShares: 1, openingBasis: { known: true, value: 1000 },
    })], { annualGrowthBps: 10000 })] }));
    expect(row(result.months, 12, 9999)).toMatchObject({ heldShares: 1, closingValueCents: 2000 });
  });

  it('returns no schedule records for ordinary accounts or an empty account list', () => {
    expect(projectRsuAccounts(makePlan())).toEqual({ months: [], issues: [] });
    expect(projectRsuAccounts(makePlan({ accounts: [{ id: 'brokerage', name: 'Brokerage', ownerId: 'owner-a', type: 'taxable-brokerage', openingBalanceCents: 1000, annualGrowthBps: 0, openingIraBasis: { known: false } }] }))).toEqual({ months: [], issues: [] });
  });

  it('rejects projected monetary overflow with the engine range error', () => {
    const large = grant({ grantValueCents: MAX_CENTS, grantSharePriceCents: 1 });
    const result = () => projectRsuAccounts(makePlan({ accounts: [account([large], {
      annualGrowthBps: 10000, rsu: { employerId: 'employer', currentSharePriceCents: 1, grants: [large] },
    })] }));
    expect(result).toThrow(CalculationRangeError);
  });

  it('keeps an exhausted grant at zero when an unused hypothetical share price exceeds the money range', () => {
    const historical = grant({ startDate: '2024-01-01', withholdingBps: 10000 });
    const result = projectRsuAccounts(makePlan({ accounts: [account([historical], {
      annualGrowthBps: 10000,
      rsu: { employerId: 'employer', currentSharePriceCents: MAX_CENTS, grants: [historical] },
    })] }));
    expect(result.months.every(value => value.closingValueCents === 0 && value.unvestedValueCents === 0 && value.taxableIncomeCents === 0)).toBe(true);
  });

  it('allows a large internal share price when actual fractional holdings remain in range', () => {
    const fractional = grant({
      startDate: '2024-01-01', awardedShares: 0.000001, openingHeldShares: 0.000001,
      openingBasis: { known: true, value: 1 },
    });
    const result = projectRsuAccounts(makePlan({ accounts: [account([fractional], {
      annualGrowthBps: 10000,
      rsu: { employerId: 'employer', currentSharePriceCents: MAX_CENTS, grants: [fractional] },
    })] }));
    expect(row(result.months, 12)).toMatchObject({ heldShares: 0.000001, closingValueCents: 200000000, basis: { known: true, value: 1 } });
    expect(result.months.reduce((sum, value) => sum + value.growthCents, 0)).toBe(100000000);
  });

  it('isolates unvested paper-value overflow from known shares, compensation and held assets', () => {
    const paper = grant({
      grantValueCents: 60000000000000, grantSharePriceCents: 1,
      vestingMonths: 48, cliffMonths: 48,
    });
    const result = projectRsuAccounts(makePlan({ accounts: [account([paper], {
      rsu: { employerId: 'employer', currentSharePriceCents: 2, grants: [paper] },
    })] }));
    expect(result.months).toHaveLength(12);
    expect(row(result.months, 1)).toMatchObject({
      vestedShares: 0, heldShares: 0, unvestedShares: 60000000000000,
      taxableIncomeCents: 0, withholdingCents: 0, closingValueCents: 0,
      unvestedValueCents: null,
      unvestedValueIssue: { code: 'monetary-overflow', recordId: 'employer-stock', year: 2026, field: 'rsu.currentSharePriceCents' },
    });
    expect(result.months.every(value => value.unvestedValueCents === null && value.taxableIncomeCents === 0 && value.closingValueCents === 0)).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: 'monetary-overflow', recordId: 'employer-stock', year: 2026, field: 'rsu.currentSharePriceCents' });
  });

  it('keeps each supported vest month available when unreported lifetime compensation exceeds the range', () => {
    const large = grant({
      startDate: '2025-12-01', grantValueCents: 25000000000000, grantSharePriceCents: 1,
      vestingMonths: 48, vestingFrequency: 'annual', withholdingBps: 10000,
    });
    const result = projectRsuAccounts(makePlan({ horizonYears: 4, accounts: [account([large], {
      annualGrowthBps: 10000,
      rsu: { employerId: 'employer', currentSharePriceCents: 1, grants: [large] },
    })] }));
    expect(result.months).toHaveLength(48);
    // Independent 80-digit Decimal calculation, with rounded cumulative remainders.
    expect(result.months.filter(value => value.vestedShares > 0).map(value => value.taxableIncomeCents)).toEqual([
      11798428908521, 23596857817043, 47193715634084, 94387431268170,
    ]);
    expect(row(result.months, 12, 2029)).toMatchObject({
      vestedShares: 6250000000000, withheldShares: 6250000000000,
      heldShares: 0, unvestedShares: 0, closingValueCents: 0, growthCents: 0,
      taxableIncomeCents: 94387431268170, withholdingCents: 94387431268170,
      basis: { known: true, value: 0 },
    });
    expect(result.months.reduce((sum, value) => sum + value.taxableIncomeCents, 0)).toBeGreaterThan(MAX_CENTS);
    for (const value of result.months) {
      expect(value.taxableIncomeCents).toBeLessThanOrEqual(MAX_CENTS);
      expect(value.withholdingCents).toBeLessThanOrEqual(MAX_CENTS);
      expect(value.closingValueCents - value.openingValueCents).toBe(value.growthCents + value.vestedValueCents - value.withholdingCents);
    }
  });

  it('does not mutate the input plan or its nested grants', () => {
    const plan = makePlan({ accounts: [account([grant()])] });
    const before = JSON.stringify(plan);
    projectRsuAccounts(plan);
    expect(JSON.stringify(plan)).toBe(before);
  });
});
