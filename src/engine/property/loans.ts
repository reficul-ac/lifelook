import { calendarDate, isValidYearMonth, parseISODate } from '../dates';
import {
  assertMonetaryRange, CalculationRangeError, Decimal, settleCents,
} from '../money';
import type {
  BasisPoints, Cents, Debt, ISODate, PropertyLoan,
} from '../model/plan';
import type { Issue } from '../model/results';

export type OpeningLoanProvenance = 'known' | 'estimated';

export interface LoanMonth {
  readonly loanId: string;
  readonly date: ISODate;
  /** A planned purchase mortgage enters the balance sheet at closing. */
  readonly drawCents?: Cents;
  readonly openingPrincipalCents: Cents;
  readonly interestCents: Cents;
  readonly paymentCents: Cents;
  readonly principalPaidCents: Cents;
  readonly closingPrincipalCents: Cents;
  readonly openingProvenance: OpeningLoanProvenance;
  readonly issues: readonly Issue[];
}

/** Evidence only: the tax module selects the applicable official method. */
export interface LoanAverageBalanceEvidence {
  readonly year: number;
  readonly openingPrincipalCents: Cents;
  readonly closingPrincipalCents: Cents;
  readonly monthlyOpeningPrincipalCents: readonly Cents[];
  readonly monthlyClosingPrincipalCents: readonly Cents[];
}

export type MortgageQualificationEvidence = Readonly<Pick<PropertyLoan,
  'collateralPropertyId' | 'acquisitionDate' | 'originationDate'
  | 'originalPrincipalCents' | 'proceedsQualification' | 'proceedsAllocations'
  | 'financingAtRiskQualification'>>;

export interface LoanSchedule {
  readonly loanId: string;
  readonly startYear: number;
  readonly horizonYears: number;
  readonly months: readonly LoanMonth[];
  readonly openingProvenance: OpeningLoanProvenance;
  readonly paymentProvenance: OpeningLoanProvenance;
  readonly averageBalanceEvidence: readonly LoanAverageBalanceEvidence[];
  readonly qualification?: MortgageQualificationEvidence;
  readonly issues: readonly Issue[];
}

function requireNonnegativeCents(cents: Cents): void {
  const value = new Decimal(cents);
  assertMonetaryRange(value);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('A loan amount must be a nonnegative integer number of cents.');
  }
}

function requireApr(aprBps: BasisPoints): void {
  if (!Number.isInteger(aprBps) || aprBps < 0 || aprBps > 100000) {
    throw new RangeError('Loan APR must be integer basis points from 0 through 100000.');
  }
}

/** Fixed payment from nominal APR/12; contractual term does not forgive residual cents. */
export function scheduledPayment(
  principalCents: Cents, aprBps: BasisPoints, termMonths: number,
): Cents {
  requireNonnegativeCents(principalCents);
  requireApr(aprBps);
  if (!Number.isSafeInteger(termMonths) || termMonths <= 0) {
    throw new RangeError('Loan term must be a positive integer number of months.');
  }
  if (principalCents === 0) return 0;
  const principal = new Decimal(principalCents);
  if (aprBps === 0) return settleCents(principal.div(termMonths));
  const rate = new Decimal(aprBps).div(120000);
  return settleCents(principal.times(rate).div(
    new Decimal(1).minus(new Decimal(1).plus(rate).pow(-termMonths)),
  ));
}

interface PaymentStep {
  readonly interestCents: Cents;
  readonly paymentCents: Cents;
  readonly principalPaidCents: Cents;
  readonly closingPrincipalCents: Cents;
}

function paymentStep(opening: Cents, aprBps: BasisPoints, payment: Cents): PaymentStep {
  if (opening === 0) {
    return { interestCents: 0, paymentCents: 0, principalPaidCents: 0,
      closingPrincipalCents: 0 };
  }
  const openingExact = new Decimal(opening);
  const interestCents = settleCents(openingExact.times(aprBps).div(120000));
  const due = openingExact.plus(interestCents);
  // Check the full due aggregate before converting or subtracting a payment.
  assertMonetaryRange(due);
  const paymentCents = settleCents(Decimal.min(payment, due));
  const principalPaidCents = settleCents(new Decimal(paymentCents).minus(interestCents));
  const closingPrincipalCents = settleCents(openingExact.minus(principalPaidCents));
  return { interestCents, paymentCents, principalPaidCents, closingPrincipalCents };
}

function monthIndex(year: number, month: number): number { return year * 12 + month - 1; }

function historicalOpening(loan: PropertyLoan, startYear: number): Cents {
  const first = parseISODate(loan.firstPaymentDate);
  const startIndex = monthIndex(startYear, 1);
  const firstIndex = monthIndex(first.year, first.month);
  const payment = scheduledPayment(loan.originalPrincipalCents, loan.aprBps, loan.termMonths);
  let balance = loan.originalPrincipalCents;
  for (let index = firstIndex; index < startIndex && balance > 0; index += 1) {
    balance = paymentStep(balance, loan.aprBps, payment).closingPrincipalCents;
  }
  return balance;
}

/**
 * Cash schedules do not depend on mortgage deductibility. Existing unpaid debt
 * accrues nominal monthly interest even before its first scheduled payment.
 */
export function calculateLoanSchedule(
  loan: Debt | PropertyLoan, startYear: number, horizonYears: number,
  options?: Readonly<{ plannedOrigination?: boolean }>,
): LoanSchedule {
  calendarDate(startYear, 1, 1);
  if (!Number.isInteger(horizonYears) || horizonYears < 1 || horizonYears > 40) {
    throw new RangeError('Loan horizon must be from 1 through 40 years.');
  }
  calendarDate(startYear + horizonYears - 1, 12, 31);
  requireApr(loan.aprBps);
  const propertyLoan = 'originalPrincipalCents' in loan;
  let opening: Cents;
  let payment: Cents;
  let firstIndex: number;
  let openingProvenance: OpeningLoanProvenance;
  let paymentProvenance: OpeningLoanProvenance;
  let qualification: MortgageQualificationEvidence | undefined;
  let originationIndex: number | undefined;
  if (propertyLoan) {
    requireNonnegativeCents(loan.originalPrincipalCents);
    const first = parseISODate(loan.firstPaymentDate);
    firstIndex = monthIndex(first.year, first.month);
    const planned = options?.plannedOrigination
      || loan.originationDate > calendarDate(startYear, 1, 1);
    if (planned) {
      const originated = parseISODate(loan.originationDate);
      originationIndex = monthIndex(originated.year, originated.month);
    }
    const notYetOriginated = originationIndex !== undefined
      && originationIndex >= monthIndex(startYear, 1);
    opening = notYetOriginated ? 0 : loan.openingBalance.known
      ? loan.openingBalance.value : historicalOpening(loan, startYear);
    payment = loan.openingPayment.known
      ? loan.openingPayment.value
      : scheduledPayment(loan.originalPrincipalCents, loan.aprBps, loan.termMonths);
    openingProvenance = notYetOriginated || loan.openingBalance.known ? 'known' : 'estimated';
    paymentProvenance = loan.openingPayment.known ? 'known' : 'estimated';
    qualification = {
      collateralPropertyId: loan.collateralPropertyId,
      acquisitionDate: loan.acquisitionDate, originationDate: loan.originationDate,
      originalPrincipalCents: loan.originalPrincipalCents,
      proceedsQualification: loan.proceedsQualification,
      proceedsAllocations: loan.proceedsAllocations,
      financingAtRiskQualification: loan.financingAtRiskQualification,
    };
  } else {
    if (!isValidYearMonth(loan.firstPaymentMonth)) {
      throw new RangeError('The first debt payment requires a valid year and month.');
    }
    const [year = 0, month = 0] = loan.firstPaymentMonth.split('-').map(Number);
    firstIndex = monthIndex(year, month);
    opening = loan.openingBalanceCents;
    payment = loan.monthlyPaymentCents;
    openingProvenance = 'known';
    paymentProvenance = 'known';
  }
  requireNonnegativeCents(opening);
  requireNonnegativeCents(payment);

  const scheduleIssues: Issue[] = [];
  if (openingProvenance === 'estimated') {
    scheduleIssues.push({
      code: 'estimated-opening-loan-balance', recordId: loan.id, year: startYear,
      field: 'openingBalance', severity: 'info',
      explanation: 'The opening loan balance is estimated from the original scheduled payments.',
      resolution: 'Enter a known balance as of January 1 to replace the estimate.',
    });
  }
  const months: LoanMonth[] = [];
  for (let offset = 0; offset < horizonYears * 12; offset += 1) {
    const year = startYear + Math.floor(offset / 12);
    const month = offset % 12 + 1;
    const index = monthIndex(year, month);
    const beforeOrigination = originationIndex !== undefined && index < originationIndex;
    const drawCents = propertyLoan && index === originationIndex ? loan.originalPrincipalCents : 0;
    const activePayment = index >= firstIndex ? payment : 0;
    let step: PaymentStep;
    try {
      if (beforeOrigination) {
        step = { interestCents: 0, paymentCents: 0, principalPaidCents: 0, closingPrincipalCents: 0 };
      } else if (index === originationIndex && index < firstIndex) {
        // Closing posts the mortgage once. The first regular interest period
        // begins next month; prepaid closing interest needs separate inputs.
        step = { interestCents: 0, paymentCents: 0, principalPaidCents: 0, closingPrincipalCents: drawCents };
      } else {
        step = paymentStep(settleCents(new Decimal(opening).plus(drawCents)), loan.aprBps, activePayment);
      }
    }
    catch (error) {
      if (error instanceof CalculationRangeError) {
        throw new CalculationRangeError(
          `monetary-overflow: loan ${loan.id} in ${year}-${String(month).padStart(2, '0')}.`,
        );
      }
      throw error;
    }
    const issues: Issue[] = step.principalPaidCents < 0 ? [{
      code: 'below-interest-payment', recordId: loan.id, year,
      field: propertyLoan ? 'openingPayment' : 'monthlyPaymentCents', severity: 'warning',
      explanation: 'The payment is less than monthly interest, so unpaid interest increases the debt.',
      resolution: 'Increase the scheduled payment or account for the growing debt in the plan.',
    }] : [];
    months.push({ loanId: loan.id, date: calendarDate(year, month, 31),
      openingPrincipalCents: opening, ...(originationIndex !== undefined ? { drawCents } : {}),
      ...step, openingProvenance, issues });
    scheduleIssues.push(...issues);
    opening = step.closingPrincipalCents;
  }

  const averageBalanceEvidence: LoanAverageBalanceEvidence[] = [];
  for (let offset = 0; offset < horizonYears; offset += 1) {
    const yearMonths = months.slice(offset * 12, offset * 12 + 12);
    averageBalanceEvidence.push({
      year: startYear + offset,
      openingPrincipalCents: yearMonths[0]!.openingPrincipalCents,
      closingPrincipalCents: yearMonths[11]!.closingPrincipalCents,
      monthlyOpeningPrincipalCents: yearMonths.map(month => month.openingPrincipalCents),
      monthlyClosingPrincipalCents: yearMonths.map(month => month.closingPrincipalCents),
    });
  }
  return { loanId: loan.id, startYear, horizonYears, months, openingProvenance,
    paymentProvenance, averageBalanceEvidence, issues: scheduleIssues,
    ...(qualification ? { qualification } : {}) };
}
