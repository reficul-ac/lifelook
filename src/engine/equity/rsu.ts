import { calendarDate, daysInMonth, parseISODate } from '../dates';
import { effectiveMonthlyRate } from '../growth';
import { CalculationRangeError, Decimal, assertMonetaryRange, settleCents } from '../money';
import type { Cents, History, ISODate, PlanDocument, RsuGrant } from '../model/plan';
import type { Issue } from '../model/results';

export interface RsuVestingEvent {
  readonly date: ISODate;
  readonly shares: number;
}

export interface RsuGrantMonth {
  readonly accountId: string;
  readonly grantId: string;
  readonly year: number;
  readonly month: number;
  readonly openingValueCents: Cents;
  readonly growthCents: Cents;
  readonly vestedShares: number;
  readonly withheldShares: number;
  readonly heldShares: number;
  readonly unvestedShares: number;
  readonly unsettledShares: number;
  readonly vestedValueCents: Cents;
  readonly taxableIncomeCents: Cents;
  readonly withholdingCents: Cents;
  readonly closingValueCents: Cents;
  readonly unvestedValueCents: Cents | null;
  readonly unvestedValueIssue?: Issue;
  readonly basis: History<Cents>;
}

export interface RsuProjection {
  readonly months: readonly RsuGrantMonth[];
  readonly issues: readonly Issue[];
}

interface ExactVestingEvent {
  readonly date: ISODate;
  readonly shares: Decimal;
}

const intervalMonths: Readonly<Record<RsuGrant['vestingFrequency'], number>> = {
  monthly: 1, quarterly: 3, annual: 12,
};

function awardedShares(grant: RsuGrant): Decimal {
  return grant.awardedShares === undefined
    ? new Decimal(grant.grantValueCents).div(grant.grantSharePriceCents)
    : new Decimal(grant.awardedShares);
}

function exactVestingEvents(grant: RsuGrant): readonly ExactVestingEvent[] {
  const interval = intervalMonths[grant.vestingFrequency];
  const offsets = new Set<number>([grant.vestingMonths]);
  for (let offset = interval; offset < grant.vestingMonths; offset += interval) {
    if (offset >= grant.cliffMonths) offsets.add(offset);
  }
  if (grant.cliffMonths > 0) offsets.add(grant.cliffMonths);
  const start = parseISODate(grant.startDate), total = awardedShares(grant);
  let previous = new Decimal(0);
  return [...offsets].sort((a, b) => a - b).map(offset => {
    const calendarOffset = start.month - 1 + offset;
    const year = start.year + Math.floor(calendarOffset / 12);
    const month = calendarOffset % 12 + 1;
    const cumulative = offset === grant.vestingMonths
      ? total : total.mul(offset).div(grant.vestingMonths);
    const shares = cumulative.minus(previous);
    previous = cumulative;
    return { date: calendarDate(year, month, start.day), shares };
  });
}

/** Award reference prices determine units; they are never an exercise price. */
export function rsuVestingEvents(grant: RsuGrant): readonly RsuVestingEvent[] {
  return exactVestingEvents(grant).map(event => ({ date: event.date, shares: event.shares.toNumber() }));
}

/** Independent service vesting and held assets; deferred tax timing stays explicit. */
export function projectRsuAccounts(plan: PlanDocument): RsuProjection {
  const months: RsuGrantMonth[] = [], issues: Issue[] = [];
  const paperOverflowIssues = new Map<string, Issue>();
  const forecastStart = calendarDate(plan.startYear, 1, 1);
  for (const account of plan.accounts) {
    if (account.type !== 'rsu' || !account.rsu) continue;
    // Validate the same effective-growth range as other investment accounts.
    effectiveMonthlyRate(account.annualGrowthBps);
    const annualFactor = new Decimal(1).plus(new Decimal(account.annualGrowthBps).div(10000));
    const openingPrice = new Decimal(account.rsu.currentSharePriceCents);
    const priceAt = (year: number, month: number, day = 1): Decimal => {
      const elapsedMonths = new Decimal((year - plan.startYear) * 12 + month - 1)
        .plus(day === 1 ? 0 : new Decimal(day - 1).div(daysInMonth(year, month)));
      // A per-share price is internal; range-check the actual share-value products.
      return openingPrice.mul(annualFactor.pow(elapsedMonths.div(12)));
    };

    for (const [grantIndex, grant] of account.rsu.grants.entries()) {
      const deferred = grant.taxTreatment === 'deferred';
      const total = awardedShares(grant), events = exactVestingEvents(grant);
      if (deferred) {
        for (let year = plan.startYear; year < plan.startYear + plan.horizonYears; year++) {
          if (events[0] && events[0].date <= calendarDate(year, 12, 31)) issues.push({
            code: 'unsupported-rsu-deferred-settlement', recordId: account.id, year,
            field: `rsu.grants.${grantIndex}.taxTreatment`, severity: 'warning',
            explanation: 'Deferred RSU settlement can have separate income-tax and payroll-tax timing; service vesting alone does not establish household tax or cash results.',
            resolution: 'Use settlement at each vest for the supported ordinary RSU treatment, or supply a supported deferred-settlement tax schedule.',
          });
        }
      }
      let eventIndex = 0, serviceVested = new Decimal(0);
      // Past vesting determines remaining service units but cannot recreate holdings or wages.
      while (events[eventIndex] && events[eventIndex]!.date < forecastStart) {
        serviceVested = serviceVested.plus(events[eventIndex]!.shares);
        eventIndex++;
      }
      let held = new Decimal(grant.openingHeldShares);
      let basisExact = grant.openingBasis.known ? new Decimal(grant.openingBasis.value) : undefined;
      let vestedValueExact = new Decimal(0), withholdingExact = new Decimal(0);
      let priorVestedValueRounded = new Decimal(0), priorWithholdingRounded = new Decimal(0);
      const withholdingFraction = new Decimal(grant.withholdingBps).div(10000);

      for (let offset = 0; offset < plan.horizonYears * 12; offset++) {
        const year = plan.startYear + Math.floor(offset / 12), month = offset % 12 + 1;
        const monthEnd = calendarDate(year, month, daysInMonth(year, month));
        const openingValueCents = settleCents(held.mul(priceAt(year, month)));
        let vested = new Decimal(0), withheld = new Decimal(0);
        while (events[eventIndex] && events[eventIndex]!.date <= monthEnd) {
          const event = events[eventIndex]!, date = parseISODate(event.date);
          const value = event.shares.mul(priceAt(date.year, date.month, date.day));
          assertMonetaryRange(value);
          serviceVested = serviceVested.plus(event.shares);
          vested = vested.plus(event.shares);
          vestedValueExact = vestedValueExact.plus(value);
          if (!deferred) {
            const sold = event.shares.mul(withholdingFraction);
            const retained = event.shares.minus(sold);
            withheld = withheld.plus(sold);
            held = held.plus(retained);
            withholdingExact = withholdingExact.plus(value.mul(withholdingFraction));
            if (basisExact !== undefined) basisExact = basisExact.plus(value.mul(new Decimal(1).minus(withholdingFraction)));
          }
          eventIndex++;
        }

        // Cumulative cents preserve fractional monetary remainders across vest months.
        // Lifetime totals remain Decimal; only reported monthly flows have a cents range.
        const cumulativeVestedValueRounded = vestedValueExact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        const cumulativeWithholdingRounded = withholdingExact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        const vestedValueCents = settleCents(cumulativeVestedValueRounded.minus(priorVestedValueRounded));
        const withholdingCents = settleCents(cumulativeWithholdingRounded.minus(priorWithholdingRounded));
        priorVestedValueRounded = cumulativeVestedValueRounded;
        priorWithholdingRounded = cumulativeWithholdingRounded;
        const unvested = monthEnd < grant.startDate ? new Decimal(0) : total.minus(serviceVested);
        const closingPrice = month === 12 ? priceAt(year + 1, 1) : priceAt(year, month + 1);
        const closingValueCents = settleCents(held.mul(closingPrice));
        const taxableIncomeCents = deferred ? 0 : vestedValueCents;
        const growthCents = settleCents(new Decimal(closingValueCents).minus(openingValueCents)
          .minus(taxableIncomeCents).plus(withholdingCents));
        let unvestedValueCents: Cents | null, unvestedValueIssue: Issue | undefined;
        try {
          unvestedValueCents = settleCents(unvested.mul(closingPrice));
        } catch (error) {
          if (!(error instanceof CalculationRangeError)) throw error;
          unvestedValueCents = null;
          const key = JSON.stringify([account.id, year]);
          unvestedValueIssue = paperOverflowIssues.get(key);
          if (!unvestedValueIssue) {
            unvestedValueIssue = {
              code: 'monetary-overflow', recordId: account.id, year,
              field: 'rsu.currentSharePriceCents', severity: 'warning',
              explanation: 'The unvested RSU paper value exceeds the supported monetary range. Compensation and held assets remain independently calculated.',
              resolution: 'Reduce the current share-price or annual-growth assumption to bring the unvested value within the supported monetary range.',
            };
            paperOverflowIssues.set(key, unvestedValueIssue);
            issues.push(unvestedValueIssue);
          }
        }
        months.push({
          accountId: account.id, grantId: grant.id, year, month,
          openingValueCents, growthCents, vestedShares: vested.toNumber(),
          withheldShares: withheld.toNumber(), heldShares: held.toNumber(),
          unvestedShares: unvested.toNumber(), unsettledShares: deferred ? serviceVested.toNumber() : 0,
          vestedValueCents, taxableIncomeCents, withholdingCents, closingValueCents,
          unvestedValueCents,
          ...(unvestedValueIssue ? { unvestedValueIssue } : {}),
          basis: basisExact === undefined ? { known: false } : { known: true, value: settleCents(basisExact) },
        });
      }
    }
  }
  return { months, issues };
}
