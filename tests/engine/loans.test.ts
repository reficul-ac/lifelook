import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Debt, PropertyLoan } from '../../src/engine/model/plan';
import { calculateLoanSchedule, scheduledPayment } from '../../src/engine/property/loans';

interface ReferenceMonth {
  readonly date: string;
  readonly openingPrincipalCents: number;
  readonly interestCents: number;
  readonly paymentCents: number;
  readonly principalPaidCents: number;
  readonly closingPrincipalCents: number;
}
interface LoanReference {
  readonly id: string;
  readonly input: {
    readonly loan: Debt;
    readonly startYear: number;
    readonly horizonYears: number;
    readonly termMonths: number;
  };
  readonly expected: {
    readonly scheduledPaymentCents: number;
    readonly months: readonly ReferenceMonth[];
  };
}
const references: readonly LoanReference[] = JSON.parse(readFileSync(
  new URL('../../fixtures/math/loans.json', import.meta.url), 'utf8',
));

function propertyLoan(overrides: Partial<PropertyLoan> = {}): PropertyLoan {
  return {
    id: 'mortgage', name: 'Ordinary purchase mortgage', originalPrincipalCents: 120000,
    aprBps: 600, originationDate: '2025-06-01', acquisitionDate: '2025-06-01',
    termMonths: 12, firstPaymentDate: '2025-07-31',
    openingBalance: { known: false }, openingPayment: { known: false },
    collateralPropertyId: 'home',
    proceedsQualification: {
      kind: 'acquisition', qualifiedAcquisitionDebt: { known: true, value: true },
      qualifiedPrincipalCents: { known: true, value: 120000 },
      historyComplete: { known: true, value: true },
    },
    proceedsAllocations: [
      { propertyId: 'home', use: 'personal', share: { numerator: 1, denominator: 1 } },
    ],
    financingAtRiskQualification: { known: true, value: true },
    ...overrides,
  };
}

describe('fixed-rate loans and debt cash schedules', () => {
  // A nominal/effective-rate mixup, early principal rounding, or unbounded final
  // payment must fail these independently calculated monthly worksheet rows.
  it.each(references)('matches independent cents and payoff rows: $id', c => {
    const { loan, startYear, horizonYears, termMonths } = c.input;
    expect(scheduledPayment(loan.openingBalanceCents, loan.aprBps, termMonths))
      .toBe(c.expected.scheduledPaymentCents);
    const schedule = calculateLoanSchedule(loan, startYear, horizonYears);
    expect(schedule.months).toHaveLength(12 * horizonYears);
    for (const expected of c.expected.months) {
      const actual = schedule.months.find(month => month.date === expected.date);
      expect(actual).toMatchObject(expected);
    }
  });

  it('stops payments and interest after the cent-rounded final payoff', () => {
    const loan: Debt = {
      id: 'tiny', name: 'Tiny balance', openingBalanceCents: 101,
      aprBps: 0, monthlyPaymentCents: 100, firstPaymentMonth: '2026-01',
    };
    const months = calculateLoanSchedule(loan, 2026, 1).months;
    expect(months.slice(0, 3).map(m => m.paymentCents)).toEqual([100, 1, 0]);
    expect(months.slice(2).every(m => m.interestCents === 0
      && m.closingPrincipalCents === 0)).toBe(true);
  });

  it('retains signed negative principal and locates below-interest warnings', () => {
    const loan: Debt = {
      id: 'below-interest', name: 'Below interest', openingBalanceCents: 10000,
      aprBps: 1200, monthlyPaymentCents: 50, firstPaymentMonth: '2026-01',
    };
    const schedule = calculateLoanSchedule(loan, 2026, 1);
    expect(schedule.months[0]).toMatchObject({
      interestCents: 100, paymentCents: 50, principalPaidCents: -50,
      closingPrincipalCents: 10050,
    });
    expect(schedule.months[0]?.issues).toContainEqual(expect.objectContaining({
      code: 'below-interest-payment', recordId: 'below-interest', year: 2026,
      severity: 'warning',
    }));
  });

  it('honors the first payment month without ignoring accrued interest', () => {
    const loan: Debt = {
      id: 'deferred', name: 'Deferred first payment', openingBalanceCents: 10000,
      aprBps: 1200, monthlyPaymentCents: 200, firstPaymentMonth: '2026-03',
    };
    const months = calculateLoanSchedule(loan, 2026, 1).months;
    expect(months.slice(0, 3).map(m => m.paymentCents)).toEqual([0, 0, 200]);
    expect(months.slice(0, 3).map(m => m.closingPrincipalCents))
      .toEqual([10100, 10201, 10103]);
    expect(months[1]?.date).toBe('2026-02-28');
  });

  it('reconciles all payments, interest and principal without mutating the loan', () => {
    const loan: Debt = Object.freeze({
      id: 'reconcile', name: 'Independent one-year loan', openingBalanceCents: 120000,
      aprBps: 600, monthlyPaymentCents: 10328, firstPaymentMonth: '2026-01',
    });
    const first = calculateLoanSchedule(loan, 2026, 1);
    expect(calculateLoanSchedule(loan, 2026, 1)).toEqual(first);
    expect(loan.openingBalanceCents).toBe(120000);
    for (const month of first.months) {
      expect(month.paymentCents).toBe(month.interestCents + month.principalPaidCents);
      expect(month.closingPrincipalCents)
        .toBe(month.openingPrincipalCents - month.principalPaidCents);
    }
    expect(first.months.reduce((sum, m) => sum + m.principalPaidCents, 0)).toBe(120000);
    expect(first.months[11]?.closingPrincipalCents).toBe(0);
  });

  it('rejects overflow rather than returning an approximate debt balance', () => {
    const loan: Debt = {
      id: 'overflow', name: 'Growing debt', openingBalanceCents: 99999999999999,
      aprBps: 100000, monthlyPaymentCents: 0, firstPaymentMonth: '2026-01',
    };
    expect(() => calculateLoanSchedule(loan, 2026, 1)).toThrow('monetary-overflow');
  });

  it('labels the historical scheduled opening estimate and preserves qualification evidence', () => {
    // The fixture's independently checked six installments leave 60896 cents.
    const loan = propertyLoan();
    const schedule = calculateLoanSchedule(loan, 2026, 1);
    expect(schedule.openingProvenance).toBe('estimated');
    expect(schedule.months[0]).toMatchObject({
      openingPrincipalCents: 60896, interestCents: 304,
      paymentCents: 10328, closingPrincipalCents: 50872,
    });
    expect(schedule.qualification).toEqual({
      collateralPropertyId: 'home', acquisitionDate: '2025-06-01',
      originationDate: '2025-06-01', originalPrincipalCents: 120000,
      proceedsQualification: loan.proceedsQualification,
      proceedsAllocations: loan.proceedsAllocations,
      financingAtRiskQualification: loan.financingAtRiskQualification,
    });
  });

  it('uses the known starting balance and payment instead of historical estimates', () => {
    const schedule = calculateLoanSchedule(propertyLoan({
      openingBalance: { known: true, value: 100000 },
      openingPayment: { known: true, value: 20000 },
    }), 2026, 1);
    expect(schedule.openingProvenance).toBe('known');
    expect(schedule.paymentProvenance).toBe('known');
    expect(schedule.months[0]).toMatchObject({
      openingPrincipalCents: 100000, interestCents: 500,
      paymentCents: 20000, principalPaidCents: 19500,
      closingPrincipalCents: 80500,
    });
  });

  it('distinguishes a known zero balance and payment from unknown opening history', () => {
    const paidOff = calculateLoanSchedule(propertyLoan({
      openingBalance: { known: true, value: 0 },
    }), 2026, 1);
    expect(paidOff.months.every(m => m.paymentCents === 0
      && m.interestCents === 0 && m.closingPrincipalCents === 0)).toBe(true);
    const paused = calculateLoanSchedule(propertyLoan({
      openingBalance: { known: true, value: 10000 },
      openingPayment: { known: true, value: 0 },
    }), 2026, 1);
    expect(paused.months[0]).toMatchObject({
      paymentCents: 0, interestCents: 50, closingPrincipalCents: 10050,
    });
  });

  it('keeps ordinary mortgage cash available when tax qualification is unresolved', () => {
    const loan = propertyLoan({
      openingBalance: { known: true, value: 120000 },
      firstPaymentDate: '2026-01-15',
      proceedsQualification: {
        kind: 'unknown', qualifiedAcquisitionDebt: { known: false },
        qualifiedPrincipalCents: { known: false }, historyComplete: { known: false },
      },
    });
    const schedule = calculateLoanSchedule(loan, 2026, 1);
    expect(schedule.months[0]?.paymentCents).toBe(10328);
    expect(schedule.months[0]?.date).toBe('2026-01-31');
    expect(schedule.qualification?.proceedsQualification)
      .toEqual(loan.proceedsQualification);
  });

  it('retains the full monthly balance evidence for jurisdiction-specific average-balance methods', () => {
    const loan: Debt = {
      id: 'evidence', name: 'Zero-rate annual balance evidence', openingBalanceCents: 120000,
      aprBps: 0, monthlyPaymentCents: 10000, firstPaymentMonth: '2026-01',
    };
    const schedule = calculateLoanSchedule(loan, 2026, 1);
    expect(schedule.averageBalanceEvidence[0]).toEqual({
      year: 2026, openingPrincipalCents: 120000, closingPrincipalCents: 0,
      monthlyOpeningPrincipalCents: [120000, 110000, 100000, 90000, 80000, 70000,
        60000, 50000, 40000, 30000, 20000, 10000],
      monthlyClosingPrincipalCents: [110000, 100000, 90000, 80000, 70000, 60000,
        50000, 40000, 30000, 20000, 10000, 0],
    });
  });

  it('draws a future purchase mortgage once at closing and starts regular interest the following month', () => {
    const loan = propertyLoan({
      originationDate: '2027-06-15', acquisitionDate: '2027-06-15',
      firstPaymentDate: '2027-07-31', aprBps: 1200,
      openingBalance: { known: true, value: 0 },
      openingPayment: { known: true, value: 10000 },
    });
    const schedule = calculateLoanSchedule(loan, 2026, 3);
    expect(schedule.months.slice(0, 17).every(month => month.openingPrincipalCents === 0
      && month.closingPrincipalCents === 0 && month.interestCents === 0
      && month.paymentCents === 0)).toBe(true);
    expect(schedule.months[17]).toMatchObject({
      date: '2027-06-30', openingPrincipalCents: 0, drawCents: 120000,
      interestCents: 0, paymentCents: 0, principalPaidCents: 0,
      closingPrincipalCents: 120000,
    });
    expect(schedule.months[18]).toMatchObject({
      openingPrincipalCents: 120000, drawCents: 0, interestCents: 1200,
      paymentCents: 10000, principalPaidCents: 8800, closingPrincipalCents: 111200,
    });
    expect(schedule.months.reduce((sum, month) => sum + (month.drawCents ?? 0), 0)).toBe(120000);
    expect(schedule.issues.some(issue => issue.code === 'estimated-opening-loan-balance')).toBe(false);
  });

  it('honors an explicitly scheduled closing-month mortgage payment', () => {
    const schedule = calculateLoanSchedule(propertyLoan({
      originationDate: '2027-06-15', acquisitionDate: '2027-06-15',
      firstPaymentDate: '2027-06-30', aprBps: 1200,
      openingPayment: { known: true, value: 10000 },
    }), 2027, 1);
    expect(schedule.months[5]).toMatchObject({
      openingPrincipalCents: 0, drawCents: 120000, interestCents: 1200,
      paymentCents: 10000, principalPaidCents: 8800, closingPrincipalCents: 111200,
    });
  });

  it('recognizes a planned January 1 closing when annual schedules restart', () => {
    const schedule = calculateLoanSchedule(propertyLoan({
      originationDate: '2028-01-01', acquisitionDate: '2028-01-01',
      firstPaymentDate: '2028-02-29', aprBps: 0,
      openingBalance: { known: true, value: 0 },
    }), 2028, 1, { plannedOrigination: true });
    expect(schedule.months[0]).toMatchObject({
      openingPrincipalCents: 0, drawCents: 120000, interestCents: 0,
      paymentCents: 0, closingPrincipalCents: 120000,
    });
    expect(schedule.months[1]).toMatchObject({
      openingPrincipalCents: 120000, drawCents: 0,
      paymentCents: 10000, closingPrincipalCents: 110000,
    });
  });

  it('continues the actual post-purchase balance without originating the mortgage again', () => {
    const schedule = calculateLoanSchedule(propertyLoan({
      originationDate: '2027-06-15', acquisitionDate: '2027-06-15',
      firstPaymentDate: '2027-07-31', aprBps: 0,
      openingBalance: { known: true, value: 60000 },
    }), 2028, 1, { plannedOrigination: true });
    expect(schedule.months[0]).toMatchObject({
      openingPrincipalCents: 60000, drawCents: 0,
      paymentCents: 10000, closingPrincipalCents: 50000,
    });
    expect(schedule.months.reduce((sum, month) => sum + (month.drawCents ?? 0), 0)).toBe(0);
  });
});
