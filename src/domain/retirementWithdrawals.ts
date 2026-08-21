import type { Account, Cents, FinancialSnapshot, Person, TaxLotRecord } from "./types";

export type WithdrawalClass =
  | "taxable"
  | "cash"
  | "eligible-pre-tax"
  | "penalty-pre-tax"
  | "roth";

export type RetirementTaxEstimateMethod =
  | "not-taxable"
  | "exact-tax-lots"
  | "conservative-aggregate-basis"
  | "ordinary-income"
  | "qualified-roth"
  | "unqualified-roth-ira"
  | "unqualified-employer-roth"
  | "mixed-supported"
  | "unsupported";

interface DateParts {
  year: number;
  month: number;
  day: number;
}

const parseDate = (value: string | undefined): DateParts | null => {
  if (value == null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day }
    : null;
};

const compareDateParts = (left: DateParts, right: DateParts) =>
  left.year - right.year || left.month - right.month || left.day - right.day;

const addCalendarMonths = (date: DateParts, months: number): DateParts => {
  const targetMonthIndex = date.month - 1 + months;
  const year = date.year + Math.floor(targetMonthIndex / 12);
  const month = targetMonthIndex % 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(date.day, lastDay) };
};

export const ageOnDate = (birthDate: string | undefined, date: string): number | null => {
  const birth = parseDate(birthDate);
  const onDate = parseDate(date);
  if (birth == null || onDate == null || compareDateParts(onDate, birth) < 0) return null;
  return onDate.year - birth.year - (
    onDate.month < birth.month || (onDate.month === birth.month && onDate.day < birth.day)
      ? 1
      : 0
  );
};

export const isAtLeastAge59AndHalf = (birthDate: string | undefined, date: string): boolean => {
  const birth = parseDate(birthDate);
  const onDate = parseDate(date);
  if (birth == null || onDate == null) return false;
  return compareDateParts(onDate, addCalendarMonths(birth, 59 * 12 + 6)) >= 0;
};

const ownerBirthDate = (people: readonly Person[], account: Account) =>
  people.find((person) => person.id === account.ownerPersonId)?.birthDate;

const preTaxWithdrawalClass = (account: Account, date: string, people: readonly Person[]): WithdrawalClass =>
  isAtLeastAge59AndHalf(ownerBirthDate(people, account), date)
    ? "eligible-pre-tax"
    : "penalty-pre-tax";

const classifyWithdrawal = (
  account: Account,
  date: string,
  people: readonly Person[],
): WithdrawalClass => {
  if (account.subtype != null) {
    switch (account.subtype) {
      case "taxable-brokerage": return "taxable";
      case "cash": return "cash";
      case "traditional-ira":
      case "employer-pre-tax": return preTaxWithdrawalClass(account, date, people);
      case "roth-ira":
      case "employer-roth": return "roth";
    }
  }
  if (account.kind === "checking" || account.kind === "savings") return "cash";
  if (account.kind === "retirement") return preTaxWithdrawalClass(account, date, people);
  return "taxable";
};

export const isRetirementDrawableAccount = (account: Account) =>
  account.kind !== "credit";

export const retirementWithdrawalClass = (
  snapshot: FinancialSnapshot,
  account: Account,
  date: string,
): WithdrawalClass => {
  return classifyWithdrawal(account, date, snapshot.household.people);
};

const withdrawalClassOrder: readonly WithdrawalClass[] = [
  "taxable",
  "eligible-pre-tax",
  "cash",
  "penalty-pre-tax",
  "roth",
];

export const defaultRetirementAccountOrder = (
  snapshot: FinancialSnapshot,
  date: string,
): readonly string[] => withdrawalClassOrder.flatMap((withdrawalClass) =>
  snapshot.accounts
    .filter((account) => isRetirementDrawableAccount(account) &&
      retirementWithdrawalClass(snapshot, account, date) === withdrawalClass)
    .map((account) => account.id),
);

export const resolveRetirementAccountOrder = (
  snapshot: FinancialSnapshot,
  date: string,
  override: readonly string[],
): readonly string[] => {
  const knownIds = new Set(snapshot.accounts
    .filter(isRetirementDrawableAccount)
    .map((account) => account.id));
  const seenIds = new Set<string>();
  const specified = override.filter((accountId) => {
    if (!knownIds.has(accountId) || seenIds.has(accountId)) return false;
    seenIds.add(accountId);
    return true;
  });
  return [...specified, ...defaultRetirementAccountOrder(snapshot, date).filter((accountId) => !seenIds.has(accountId))];
};

export interface RetirementDrawInput {
  amountCents: Cents;
  date: string;
  order: readonly string[];
  accounts: readonly Account[];
  balances: Readonly<Record<string, Cents>>;
  people?: readonly Person[];
  taxableBasis?: Readonly<Record<string, Cents>>;
  taxableLots?: Readonly<Record<string, readonly TaxLotRecord[]>>;
  unsupportedTaxCharacterAccountIds?: readonly string[];
  rothContributionBasis?: Readonly<Record<string, Cents>>;
}

export interface RetirementDrawSource {
  accountId: string;
  taxYear: number;
  amountCents: Cents;
  taxableGainCents: Cents;
  ordinaryIncomeCents: Cents;
  rothTaxableCents: Cents;
  earlyPenaltyCents: Cents;
  federalShortTermGainCents: Cents;
  federalLongTermGainCents: Cents;
  californiaGainCents: Cents;
  taxEstimateMethod: RetirementTaxEstimateMethod;
  taxCharacterSupported: boolean;
}

export interface RetirementDrawResult {
  fundedCents: Cents;
  unfundedCents: Cents;
  balances: Readonly<Record<string, Cents>>;
  taxableBasis: Readonly<Record<string, Cents>>;
  taxableLots: Readonly<Record<string, readonly TaxLotRecord[]>>;
  rothContributionBasis: Readonly<Record<string, Cents>>;
  sources: readonly RetirementDrawSource[];
  taxableGainCents: Cents;
  ordinaryIncomeCents: Cents;
  rothTaxableCents: Cents;
  earlyPenaltyCents: Cents;
  federalShortTermGainCents: Cents;
  federalLongTermGainCents: Cents;
  californiaGainCents: Cents;
  taxCharacterSupported: boolean;
}

const initialBasis = (
  values: Readonly<Record<string, Cents>> | undefined,
  accountId: string,
  accountBasis: Cents | null | undefined,
) => values?.[accountId] ?? accountBasis ?? 0;

const hasOwn = (values: Readonly<Record<string, Cents>> | undefined, id: string) =>
  values != null && Object.prototype.hasOwnProperty.call(values, id);

const rothQualification = (
  account: Account,
  date: string,
  people: readonly Person[],
): boolean | null => {
  const distribution = parseDate(date);
  const birthDate = ownerBirthDate(people, account);
  if (distribution == null || birthDate == null || parseDate(birthDate) == null ||
    account.rothOpeningYear == null || !Number.isInteger(account.rothOpeningYear)) {
    return null;
  }
  return isAtLeastAge59AndHalf(birthDate, date) &&
    distribution.year >= account.rothOpeningYear + 5;
};

export const drawRetirementFunds = (input: RetirementDrawInput): RetirementDrawResult => {
  const balances = { ...input.balances };
  const taxableBasis = { ...input.taxableBasis };
  const taxableLots = Object.fromEntries(Object.entries(input.taxableLots ?? {}).map(([accountId, lots]) =>
    [accountId, lots.map((lot) => ({ ...lot }))])) as Record<string, TaxLotRecord[]>;
  const rothContributionBasis = { ...input.rothContributionBasis };
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const unsupportedTaxCharacterAccountIds = new Set(input.unsupportedTaxCharacterAccountIds ?? []);

  for (const account of input.accounts) {
    const withdrawalClass = classifyWithdrawal(account, input.date, input.people ?? []);
    if (withdrawalClass === "taxable") {
      taxableBasis[account.id] = initialBasis(
        input.taxableBasis,
        account.id,
        account.taxableCostBasisCents,
      );
    }
    if (withdrawalClass === "roth") {
      if (hasOwn(input.rothContributionBasis, account.id) ||
        account.rothContributionBasisCents != null) {
        rothContributionBasis[account.id] = initialBasis(
          input.rothContributionBasis,
          account.id,
          account.rothContributionBasisCents,
        );
      }
    }
  }

  let remainingCents = input.amountCents;
  const sources: RetirementDrawSource[] = [];
  const drawnIds = new Set<string>();

  for (const accountId of input.order) {
    if (remainingCents <= 0 || drawnIds.has(accountId)) continue;
    drawnIds.add(accountId);
    const account = accountsById.get(accountId);
    if (account == null) continue;
    const availableCents = Math.max(0, balances[accountId] ?? 0);
    const amountCents = Math.min(remainingCents, availableCents);
    if (amountCents <= 0) continue;

    balances[accountId] = availableCents - amountCents;
    remainingCents -= amountCents;

    let taxableGainCents = 0;
    let ordinaryIncomeCents = 0;
    let rothTaxableCents = 0;
    let earlyPenaltyCents = 0;
    let federalShortTermGainCents = 0;
    let federalLongTermGainCents = 0;
    let californiaGainCents = 0;
    let taxEstimateMethod: RetirementTaxEstimateMethod = "not-taxable";
    let taxCharacterSupported = true;
    const withdrawalClass = classifyWithdrawal(account, input.date, input.people ?? []);

    if (withdrawalClass === "taxable") {
      const lots = taxableLots[accountId];
      const completeLots = lots != null && lots.length > 0 && lots.every((lot) =>
        parseDate(lot.acquiredOn ?? undefined) != null && Number.isSafeInteger(lot.marketValueCents) && lot.marketValueCents >= 0 &&
        Number.isSafeInteger(lot.federalBasisCents) && lot.federalBasisCents >= 0 &&
        Number.isSafeInteger(lot.californiaBasisCents) && lot.californiaBasisCents >= 0) &&
        lots.reduce((sum, lot) => sum + lot.marketValueCents, 0) === availableCents;
      if (completeLots) {
        let remainingDraw = amountCents;
        const remainingLots:TaxLotRecord[]=[];
        for (const lot of [...lots].sort((left, right) =>
          left.acquiredOn!.localeCompare(right.acquiredOn!) || left.id.localeCompare(right.id))) {
          const soldValue = Math.min(remainingDraw, lot.marketValueCents);
          const federalBasisSold = lot.marketValueCents === 0 ? 0 : Math.min(
            lot.federalBasisCents,
            Math.round(lot.federalBasisCents * soldValue / lot.marketValueCents),
          );
          const californiaBasisSold = lot.marketValueCents === 0 ? 0 : Math.min(
            lot.californiaBasisCents,
            Math.round(lot.californiaBasisCents * soldValue / lot.marketValueCents),
          );
          const federalGain = soldValue - federalBasisSold;
          const californiaGain = soldValue - californiaBasisSold;
          const acquired = parseDate(lot.acquiredOn!);
          const disposed = parseDate(input.date);
          const shortTerm = acquired == null || disposed == null || compareDateParts(
            disposed,
            addCalendarMonths(acquired, 12),
          ) <= 0;
          if (shortTerm) federalShortTermGainCents += federalGain;
          else federalLongTermGainCents += federalGain;
          californiaGainCents += californiaGain;
          remainingDraw -= soldValue;
          if (soldValue < lot.marketValueCents) remainingLots.push({
            ...lot,
            marketValueCents: lot.marketValueCents - soldValue,
            federalBasisCents: lot.federalBasisCents - federalBasisSold,
            californiaBasisCents: lot.californiaBasisCents - californiaBasisSold,
          });
        }
        taxableLots[accountId] = remainingLots;
        taxableBasis[accountId] = remainingLots.reduce((sum, lot) => sum + lot.federalBasisCents, 0);
        taxableGainCents = federalShortTermGainCents + federalLongTermGainCents;
        taxEstimateMethod = "exact-tax-lots";
        taxCharacterSupported = federalShortTermGainCents >= 0 &&
          federalLongTermGainCents >= 0 && californiaGainCents >= 0;
      } else {
        const basisCents = Math.max(0, taxableBasis[accountId] ?? 0);
        const fullLiquidation = amountCents === availableCents;
        const basisSoldCents = fullLiquidation ? basisCents : 0;
        taxableBasis[accountId] = basisCents - basisSoldCents;
        taxableGainCents = Math.max(0, amountCents - basisSoldCents);
        federalShortTermGainCents = taxableGainCents;
        californiaGainCents = taxableGainCents;
        const aggregateBasisKnown = hasOwn(input.taxableBasis, accountId) ||
          account.taxableCostBasisCents != null;
        taxEstimateMethod = aggregateBasisKnown
          ? "conservative-aggregate-basis"
          : "unsupported";
        taxCharacterSupported = aggregateBasisKnown;
      }
    } else if (withdrawalClass === "eligible-pre-tax" || withdrawalClass === "penalty-pre-tax") {
      taxEstimateMethod = "ordinary-income";
      ordinaryIncomeCents = amountCents;
      if (withdrawalClass === "penalty-pre-tax") {
        earlyPenaltyCents = Math.round(amountCents * 1_000 / 10_000);
      }
    } else if (withdrawalClass === "roth") {
      const basisKnown = Object.prototype.hasOwnProperty.call(
        rothContributionBasis,
        accountId,
      );
      const qualified = rothQualification(account, input.date, input.people ?? []);
      if (!basisKnown && qualified !== true) {
        taxEstimateMethod = "unsupported";
        taxCharacterSupported = false;
      } else if (!basisKnown) {
        taxEstimateMethod = "qualified-roth";
      } else {
        const basisCents = Math.max(0, rothContributionBasis[accountId] ?? 0);
        const contributionDistributionCents = account.subtype === "employer-roth"
          ? Math.min(basisCents, Math.round(basisCents * amountCents / availableCents))
          : Math.min(amountCents, basisCents);
        rothContributionBasis[accountId] = basisCents - contributionDistributionCents;
        const earningsDistributionCents = amountCents - contributionDistributionCents;
        if (earningsDistributionCents === 0) {
          taxEstimateMethod = account.subtype === "employer-roth"
            ? "unqualified-employer-roth"
            : "unqualified-roth-ira";
        } else if (qualified === true) {
          taxEstimateMethod = "qualified-roth";
        } else if (qualified === false) {
          rothTaxableCents = earningsDistributionCents;
          taxEstimateMethod = account.subtype === "employer-roth"
            ? "unqualified-employer-roth"
            : "unqualified-roth-ira";
          if (!isAtLeastAge59AndHalf(ownerBirthDate(input.people ?? [], account), input.date)) {
            earlyPenaltyCents = Math.round(rothTaxableCents * 1_000 / 10_000);
          }
        } else {
          taxEstimateMethod = "unsupported";
          taxCharacterSupported = false;
        }
      }
    }

    const unsupportedCharacterIsIrrelevant = withdrawalClass === "roth" &&
      rothQualification(account, input.date, input.people ?? []) === true;
    if (unsupportedTaxCharacterAccountIds.has(accountId) &&
      !unsupportedCharacterIsIrrelevant) {
      taxEstimateMethod = "unsupported";
      taxCharacterSupported = false;
    }

    sources.push({
      accountId,
      taxYear: Number(input.date.slice(0, 4)),
      amountCents,
      taxableGainCents,
      ordinaryIncomeCents,
      rothTaxableCents,
      earlyPenaltyCents,
      federalShortTermGainCents,
      federalLongTermGainCents,
      californiaGainCents,
      taxEstimateMethod,
      taxCharacterSupported,
    });
  }

  const fundedCents = input.amountCents - remainingCents;
  return {
    fundedCents,
    unfundedCents: remainingCents,
    balances,
    taxableBasis,
    taxableLots,
    rothContributionBasis,
    sources,
    taxableGainCents: sources.reduce((total, source) => total + source.taxableGainCents, 0),
    ordinaryIncomeCents: sources.reduce((total, source) => total + source.ordinaryIncomeCents, 0),
    rothTaxableCents: sources.reduce((total, source) => total + source.rothTaxableCents, 0),
    earlyPenaltyCents: sources.reduce((total, source) => total + source.earlyPenaltyCents, 0),
    federalShortTermGainCents: sources.reduce((total, source) => total + source.federalShortTermGainCents, 0),
    federalLongTermGainCents: sources.reduce((total, source) => total + source.federalLongTermGainCents, 0),
    californiaGainCents: sources.reduce((total, source) => total + source.californiaGainCents, 0),
    taxCharacterSupported: sources.every((source) => source.taxCharacterSupported),
  };
};
