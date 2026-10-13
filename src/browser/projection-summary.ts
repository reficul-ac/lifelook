import type { AnnualProjection, Available, Cents, Issue } from '../engine';
import { CalculationRangeError, Decimal, settleCents } from '../engine/money';

export interface ProjectionSummaryRow {
  readonly year: number;
  readonly netWorthCents: Available<Cents>;
  readonly totalIncomeCents: Available<Cents>;
  readonly cashIncomeCents: Available<Cents>;
  readonly postTaxIncomeCents: Available<Cents>;
  readonly expensesCents: Available<Cents>;
  readonly cashFlowCents: Available<Cents>;
}

const negative = (value: Available<Cents>): Available<Cents> => value.status === 'available' ? { status: 'available', value: -value.value } : value;

/** Annual cash available before investment transfers; retained RSU shares remain assets. */
export function projectionSummary(year: AnnualProjection): ProjectionSummaryRow {
  function sum(values: readonly Available<Cents>[], field: string): Available<Cents> {
    const unavailable = values.filter(value => value.status !== 'available');
    if (unavailable.length) {
      const issues = [...new Map(unavailable.flatMap(value => value.issues).map(issue => [JSON.stringify(issue), issue])).values()];
      return { status: unavailable.some(value => value.status === 'unsupported-case') ? 'unsupported-case' : 'needs-data', issues };
    }
    try {
      return { status: 'available', value: settleCents(values.reduce((total, value) => total.plus(value.status === 'available' ? value.value : 0), new Decimal(0))) };
    } catch (error) {
      if (!(error instanceof CalculationRangeError)) throw error;
      const issue: Issue = {
        code: 'monetary-overflow', year: year.year, field: `summary.${field}`, severity: 'error',
        explanation: 'This annual summary amount exceeds the supported monetary range.',
        resolution: 'Reduce the affected amounts or growth assumptions before using this annual summary.',
      };
      return { status: 'unsupported-case', issues: [issue] };
    }
  }

  const cashIncomeCents = sum([year.salaryCents, year.otherIncomeCents, year.rentCents], 'cashIncomeCents');
  // Account withholding stays independent of unavailable unvested paper valuation.
  const rsuWithholdingCents = sum(year.accounts.flatMap(account => account.withholdingCents ? [account.withholdingCents] : []), 'rsuWithholdingCents');
  const postTaxIncomeCents = sum([cashIncomeCents, negative(year.totalTaxCents), rsuWithholdingCents], 'postTaxIncomeCents');
  const expensesCents = sum([year.expensesCents, year.debtPaymentCents], 'expensesCents');
  const cashFlowCents = sum([postTaxIncomeCents, negative(expensesCents)], 'cashFlowCents');
  return { year: year.year, netWorthCents: year.netWorthCents, totalIncomeCents: year.grossIncomeCents, cashIncomeCents, postTaxIncomeCents, expensesCents, cashFlowCents };
}
