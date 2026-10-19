import { effectiveMonthlyRate } from '../growth';
import { isValidISODate } from '../dates';
import type { Cents } from '../model/plan';
import type { Available, Issue } from '../model/results';
import { assertMonetaryRange, CalculationRangeError, Decimal, settleCents } from '../money';

export interface BrokerageFundingAccount {
  readonly accountId: string;
  readonly annualGrowthBps: number;
  readonly openingExact: Decimal;
  readonly openingBasisCents: Cents;
}

export interface BrokerageFundingEvent {
  readonly id: string;
  readonly projectId: string;
  readonly propertyId: string;
  readonly accountId: string;
  readonly date: string;
  readonly constructionCents: Cents;
  /** Omitted for existing ADU construction events. */
  readonly purpose?: 'property-down-payment';
}

export interface BrokerageSale extends BrokerageFundingEvent {
  readonly grossSaleCents: Cents;
  readonly basisConsumedCents: Cents;
  readonly realizedGainCents: Cents;
  readonly federalTaxCents: Cents;
  readonly californiaTaxCents: Cents;
  readonly constructionFundedCents: Cents;
  readonly shortfallCents: Cents;
  readonly residualCents: Cents;
}

export interface BrokerageFundingContribution {
  readonly accountId: string;
  readonly month: number;
  readonly amountCents: Cents;
}

export interface BrokerageFundingTax {
  readonly eventId: string;
  /** Signed incremental household tax, attributed in chronological sale order. */
  readonly federalTaxCents: Cents;
  readonly californiaTaxCents: Cents;
}

export interface BrokerageFundingEvaluation<T> {
  readonly payload: T;
  readonly contributions: readonly BrokerageFundingContribution[];
  readonly taxes: readonly BrokerageFundingTax[];
}

export interface BrokerageFundingMonth {
  readonly month: number;
  readonly openingCents: Cents;
  readonly growthCents: Cents;
  readonly contributionCents: Cents;
  readonly grossSaleCents: Cents;
  readonly realizedGainCents: Cents;
  readonly closingCents: Cents;
  readonly closingExact: Decimal;
  readonly openingBasisCents: Cents;
  readonly basisConsumedCents: Cents;
  readonly closingBasisCents: Cents;
}

export interface BrokerageFundingAccountResult {
  readonly accountId: string;
  readonly months: readonly BrokerageFundingMonth[];
  readonly closingExact: Decimal;
  readonly closingBasisCents: Cents;
}

export interface BrokerageFundingResult<T> {
  readonly sales: readonly BrokerageSale[];
  readonly accounts: readonly BrokerageFundingAccountResult[];
  readonly evaluation: BrokerageFundingEvaluation<T>;
}

export interface BrokerageFundingInput<T> {
  readonly year: number;
  readonly accounts: readonly BrokerageFundingAccount[];
  readonly events: readonly BrokerageFundingEvent[];
  /** Internal retry budget; the ordinary standalone solver retains 64 passes. */
  readonly maxScheduleIterations?: number;
  /** Recompute household tax and allocation from all proposed sales. */
  readonly evaluate: (sales: readonly BrokerageSale[]) => Available<BrokerageFundingEvaluation<T>>;
}

interface Ledger {
  readonly sales: readonly BrokerageSale[];
  readonly accounts: readonly BrokerageFundingAccountResult[];
  readonly availableByEvent: ReadonlyMap<string, Cents>;
}

const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const cents = (value: Decimal): Cents => settleCents(value);
const sum = (values: readonly Cents[]): Cents => cents(values.reduce((total, value) => total.plus(value), new Decimal(0)));

function problem(code: string, year: number, explanation: string): Issue {
  return { code, year, field: 'ownerFunding', severity: 'warning', explanation,
    resolution: 'Review the brokerage balance, aggregate tax basis, funded payments, and household tax inputs.' };
}

class FundingInputError extends Error {}

function checkMoney(value: Cents, nonnegative = false): void {
  assertMonetaryRange(new Decimal(value));
  if (!Number.isSafeInteger(value) || nonnegative && value < 0) {
    throw new FundingInputError('Brokerage amounts must be supported integer cents.');
  }
}

function normalizeContributions(
  rows: readonly BrokerageFundingContribution[], accountIds: ReadonlySet<string>,
): readonly BrokerageFundingContribution[] {
  const totals = new Map<string, BrokerageFundingContribution>();
  for (const row of rows) {
    checkMoney(row.amountCents, true);
    if (!Number.isInteger(row.month) || row.month < 1 || row.month > 12) {
      throw new FundingInputError('Brokerage contributions require calendar months 1 through 12.');
    }
    if (!accountIds.has(row.accountId) || row.amountCents === 0) continue;
    const key = JSON.stringify([row.accountId, row.month]);
    totals.set(key, { accountId: row.accountId, month: row.month,
      amountCents: sum([totals.get(key)?.amountCents ?? 0, row.amountCents]) });
  }
  return Object.freeze([...totals.values()].sort((a, b) => compareId(a.accountId, b.accountId) || a.month - b.month)
    .map(row => Object.freeze(row)));
}

function normalizeTaxes(rows: readonly BrokerageFundingTax[], events: readonly BrokerageFundingEvent[]): readonly BrokerageFundingTax[] {
  const byId = new Map<string, BrokerageFundingTax>();
  const eventIds = new Set(events.map(event => event.id));
  for (const row of rows) {
    checkMoney(row.federalTaxCents);
    checkMoney(row.californiaTaxCents);
    if (!eventIds.has(row.eventId) || byId.has(row.eventId)) {
      throw new FundingInputError('Tax attribution requires one row per brokerage sale.');
    }
    byId.set(row.eventId, Object.freeze({ eventId: row.eventId,
      federalTaxCents: row.federalTaxCents, californiaTaxCents: row.californiaTaxCents }));
  }
  if (byId.size !== events.length) throw new FundingInputError('Tax attribution is missing a brokerage sale.');
  return Object.freeze(events.map(event => byId.get(event.id)!));
}

function simulate(
  accounts: readonly BrokerageFundingAccount[], events: readonly BrokerageFundingEvent[],
  grossByEvent: ReadonlyMap<string, Cents>, contributions: readonly BrokerageFundingContribution[],
  taxes: readonly BrokerageFundingTax[],
): Ledger {
  const salesById = new Map<string, BrokerageSale>();
  const availableByEvent = new Map<string, Cents>();
  const taxByEvent = new Map(taxes.map(tax => [tax.eventId, tax]));
  const results = accounts.map(account => {
    let exact = new Decimal(account.openingExact);
    let basis = account.openingBasisCents;
    const factor = effectiveMonthlyRate(account.annualGrowthBps).plus(1);
    const months: BrokerageFundingMonth[] = [];
    for (let month = 1; month <= 12; month++) {
      const openingCents = cents(exact), openingBasisCents = basis;
      exact = exact.mul(factor);
      assertMonetaryRange(exact);
      const growthCents = cents(new Decimal(cents(exact)).minus(openingCents));
      const monthSales: BrokerageSale[] = [];
      for (const event of events.filter(event => event.accountId === account.accountId && Number(event.date.slice(5, 7)) === month)) {
        const availableCents = Math.max(0, cents(exact));
        availableByEvent.set(event.id, availableCents);
        const grossSaleCents = Math.min(availableCents, grossByEvent.get(event.id) ?? event.constructionCents);
        const fullLiquidation = grossSaleCents > 0 && grossSaleCents === availableCents;
        const basisConsumedCents = grossSaleCents === 0 ? 0 : fullLiquidation ? basis
          : Math.min(basis, cents(new Decimal(basis).mul(grossSaleCents).div(exact)));
        const realizedGainCents = cents(new Decimal(grossSaleCents).minus(basisConsumedCents));
        const tax = taxByEvent.get(event.id);
        const federalTaxCents = tax?.federalTaxCents ?? 0, californiaTaxCents = tax?.californiaTaxCents ?? 0;
        const net = cents(new Decimal(grossSaleCents).minus(federalTaxCents).minus(californiaTaxCents));
        const constructionFundedCents = Math.min(event.constructionCents, Math.max(0, net));
        const sale = Object.freeze({ ...event, grossSaleCents, basisConsumedCents, realizedGainCents,
          federalTaxCents, californiaTaxCents, constructionFundedCents,
          shortfallCents: event.constructionCents - constructionFundedCents,
          residualCents: Math.max(0, cents(new Decimal(net).minus(event.constructionCents))) });
        salesById.set(event.id, sale);
        monthSales.push(sale);
        exact = fullLiquidation ? new Decimal(0) : exact.minus(grossSaleCents);
        basis -= basisConsumedCents;
      }
      const contributionCents = sum(contributions.filter(row => row.accountId === account.accountId && row.month === month).map(row => row.amountCents));
      exact = exact.plus(contributionCents);
      assertMonetaryRange(exact);
      basis = sum([basis, contributionCents]);
      months.push(Object.freeze({ month, openingCents, growthCents, contributionCents,
        grossSaleCents: sum(monthSales.map(sale => sale.grossSaleCents)),
        realizedGainCents: sum(monthSales.map(sale => sale.realizedGainCents)),
        closingCents: cents(exact), closingExact: new Decimal(exact), openingBasisCents,
        basisConsumedCents: sum(monthSales.map(sale => sale.basisConsumedCents)), closingBasisCents: basis }));
    }
    return Object.freeze({ accountId: account.accountId, months: Object.freeze(months),
      closingExact: new Decimal(exact), closingBasisCents: basis });
  });
  return { sales: Object.freeze(events.map(event => salesById.get(event.id)!)),
    accounts: Object.freeze(results), availableByEvent };
}

/** Monthly growth precedes dated sales; accepted contributions arrive at month end. */
export function solveBrokerageFunding<T>(input: BrokerageFundingInput<T>): Available<BrokerageFundingResult<T>> {
  try {
    const maxScheduleIterations = input.maxScheduleIterations ?? 64;
    if (!Number.isInteger(maxScheduleIterations) || maxScheduleIterations < 1 || maxScheduleIterations > 64) {
      throw new FundingInputError('Brokerage schedule iterations must be an integer from 1 through 64.');
    }
    const accountIds = new Set<string>();
    if (!Number.isInteger(input.year) || input.year < 1 || input.year > 9999) throw new FundingInputError('A valid brokerage funding year is required.');
    for (const account of input.accounts) {
      if (!account.accountId || accountIds.has(account.accountId)) throw new FundingInputError('Brokerage accounts require unique IDs.');
      accountIds.add(account.accountId);
      assertMonetaryRange(account.openingExact);
      if (account.openingExact.isNegative()) throw new FundingInputError('Opening brokerage balances must be nonnegative.');
      checkMoney(account.openingBasisCents, true);
      effectiveMonthlyRate(account.annualGrowthBps);
    }
    const eventIds = new Set<string>();
    for (const event of input.events) {
      checkMoney(event.constructionCents, true);
      if (!event.id || eventIds.has(event.id) || !accountIds.has(event.accountId)
        || !isValidISODate(event.date) || Number(event.date.slice(0, 4)) !== input.year) {
        throw new FundingInputError('Funding sales require unique IDs, an existing brokerage account, and a date in the funding year.');
      }
      eventIds.add(event.id);
    }
    const events = input.events.filter(event => event.constructionCents > 0)
      .sort((a, b) => compareId(a.date, b.date) || compareId(a.id, b.id));
    const accounts = [...input.accounts].sort((a, b) => compareId(a.accountId, b.accountId));
    const grossByEvent = new Map(events.map(event => [event.id, event.constructionCents]));
    let contributions: readonly BrokerageFundingContribution[] = [];
    let taxes: readonly BrokerageFundingTax[] = events.map(event => ({ eventId: event.id, federalTaxCents: 0, californiaTaxCents: 0 }));
    const seen = new Set<string>();

    for (let iteration = 0; iteration < maxScheduleIterations; iteration++) {
      interface Probe { readonly ledger: Ledger; readonly evaluation: BrokerageFundingEvaluation<T> }
      const probe = (proposed: ReadonlyMap<string, Cents>): Available<Probe> => {
        const provisional = simulate(accounts, events, proposed, contributions, taxes);
        const result = input.evaluate(provisional.sales);
        if (result.status !== 'available') return result;
        const evaluation: BrokerageFundingEvaluation<T> = {
          payload: result.value.payload,
          contributions: normalizeContributions(result.value.contributions, accountIds),
          taxes: normalizeTaxes(result.value.taxes, events),
        };
        return { status: 'available', value: {
          ledger: simulate(accounts, events, proposed, contributions, evaluation.taxes), evaluation,
        } };
      };

      for (const event of events) {
        const index = events.indexOf(event);
        let amount = 0;
        const attemptedAmounts = new Set<Cents>();
        let solved = false;
        for (let step = 0; step < 512; step++) {
          const proposed = new Map(grossByEvent);
          proposed.set(event.id, amount);
          const attempted = probe(proposed);
          if (attempted.status !== 'available') return attempted;
          const sale = attempted.value.ledger.sales[index]!;
          const capacity = attempted.value.ledger.availableByEvent.get(event.id)!;
          const required = new Decimal(event.constructionCents).plus(sale.federalTaxCents).plus(sale.californiaTaxCents);
          const next = cents(Decimal.max(0, Decimal.min(capacity, required)));
          if (next === sale.grossSaleCents) {
            grossByEvent.set(event.id, next);
            solved = true;
            break;
          }
          if (attemptedAmounts.has(next)) return { status: 'needs-data', issues: [problem('brokerage-funding-cycle', input.year,
            'A brokerage sale and its incremental tax repeat without a consistent gross-up amount.')] };
          attemptedAmounts.add(amount);
          // Starting at zero finds the least fixed point for nondecreasing tax.
          // Net proceeds need not be monotone: a whole-dollar tax step can
          // produce separate covering intervals that net-proceeds bisection
          // would skip. Signed tax deltas can also require downward steps.
          amount = next;
        }
        if (!solved) return { status: 'needs-data', issues: [problem('brokerage-funding-nonconvergence', input.year,
          'A brokerage sale and its incremental tax did not converge to a verified gross-up amount.')] };
      }

      const final = probe(grossByEvent);
      if (final.status !== 'available') return final;
      const replay = input.evaluate(final.value.ledger.sales);
      if (replay.status !== 'available') return replay;
      const evaluation: BrokerageFundingEvaluation<T> = { payload: replay.value.payload,
        contributions: normalizeContributions(replay.value.contributions, accountIds),
        taxes: normalizeTaxes(replay.value.taxes, events) };
      const schedulesMatch = JSON.stringify(contributions) === JSON.stringify(evaluation.contributions)
        && JSON.stringify(taxes) === JSON.stringify(evaluation.taxes)
        && JSON.stringify(final.value.evaluation.taxes) === JSON.stringify(evaluation.taxes);
      let verified = schedulesMatch;
      if (verified) {
        for (const [index, sale] of final.value.ledger.sales.entries()) {
          if (sale.shortfallCents > 0) {
            if (sale.grossSaleCents !== final.value.ledger.availableByEvent.get(sale.id)) { verified = false; break; }
          } else if (sale.grossSaleCents > 0) {
            const proposed = new Map(grossByEvent);
            proposed.set(sale.id, sale.grossSaleCents - 1);
            const previous = probe(proposed);
            if (previous.status !== 'available') return previous;
            if (previous.value.ledger.sales[index]!.shortfallCents === 0) { verified = false; break; }
          }
        }
      }
      if (verified) return { status: 'available', value: {
        sales: final.value.ledger.sales, accounts: final.value.ledger.accounts, evaluation,
      } };

      const signature = JSON.stringify([events.map(event => grossByEvent.get(event.id)), evaluation.contributions, evaluation.taxes]);
      if (seen.has(signature)) return { status: 'needs-data', issues: [problem('brokerage-funding-cycle', input.year,
        'Brokerage sales, tax, and accepted contributions repeat without a consistent annual funding result.')] };
      seen.add(signature);
      contributions = evaluation.contributions;
      taxes = evaluation.taxes;
    }
    return { status: 'needs-data', issues: [problem('brokerage-funding-nonconvergence', input.year,
      'Brokerage sales, tax, and accepted contributions did not converge to a verified annual funding result.')] };
  } catch (error) {
    if (error instanceof FundingInputError || error instanceof RangeError && !(error instanceof CalculationRangeError)) {
      return { status: 'needs-data', issues: [problem('invalid-brokerage-funding-input', input.year, error.message)] };
    }
    if (!(error instanceof CalculationRangeError)) throw error;
    return { status: 'needs-data', issues: [problem('monetary-overflow', input.year,
      'Brokerage funding exceeds the supported monetary range.')] };
  }
}
