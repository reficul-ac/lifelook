import type { Account, Cents, FinancialSnapshot, Person } from "./types";

export type WithdrawalClass =
  | "taxable"
  | "cash"
  | "eligible-pre-tax"
  | "penalty-pre-tax"
  | "roth";

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
    .filter((account) => retirementWithdrawalClass(snapshot, account, date) === withdrawalClass)
    .map((account) => account.id),
);

export const resolveRetirementAccountOrder = (
  snapshot: FinancialSnapshot,
  date: string,
  override: readonly string[],
): readonly string[] => {
  const knownIds = new Set(snapshot.accounts.map((account) => account.id));
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
  rothContributionBasis?: Readonly<Record<string, Cents>>;
}

export interface RetirementDrawSource {
  accountId: string;
  amountCents: Cents;
  taxableGainCents: Cents;
  ordinaryIncomeCents: Cents;
  rothTaxableCents: Cents;
  earlyPenaltyCents: Cents;
}

export interface RetirementDrawResult {
  fundedCents: Cents;
  unfundedCents: Cents;
  balances: Readonly<Record<string, Cents>>;
  taxableBasis: Readonly<Record<string, Cents>>;
  rothContributionBasis: Readonly<Record<string, Cents>>;
  sources: readonly RetirementDrawSource[];
  taxableGainCents: Cents;
  ordinaryIncomeCents: Cents;
  rothTaxableCents: Cents;
  earlyPenaltyCents: Cents;
}

const initialBasis = (
  values: Readonly<Record<string, Cents>> | undefined,
  accountId: string,
  accountBasis: Cents | null | undefined,
) => values?.[accountId] ?? accountBasis ?? 0;

export const drawRetirementFunds = (input: RetirementDrawInput): RetirementDrawResult => {
  const balances = { ...input.balances };
  const taxableBasis = { ...input.taxableBasis };
  const rothContributionBasis = { ...input.rothContributionBasis };
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));

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
      rothContributionBasis[account.id] = initialBasis(
        input.rothContributionBasis,
        account.id,
        account.rothContributionBasisCents,
      );
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
    const withdrawalClass = classifyWithdrawal(account, input.date, input.people ?? []);

    if (withdrawalClass === "taxable") {
      const basisCents = Math.max(0, taxableBasis[accountId] ?? 0);
      const basisSoldCents = Math.min(basisCents, Math.round(basisCents * amountCents / availableCents));
      taxableBasis[accountId] = basisCents - basisSoldCents;
      taxableGainCents = amountCents - basisSoldCents;
    } else if (withdrawalClass === "eligible-pre-tax" || withdrawalClass === "penalty-pre-tax") {
      ordinaryIncomeCents = amountCents;
      if (withdrawalClass === "penalty-pre-tax") {
        earlyPenaltyCents = Math.round(amountCents * 1_000 / 10_000);
      }
    } else if (withdrawalClass === "roth") {
      const basisCents = Math.max(0, rothContributionBasis[accountId] ?? 0);
      const contributionDistributionCents = Math.min(amountCents, basisCents);
      rothContributionBasis[accountId] = basisCents - contributionDistributionCents;
      rothTaxableCents = amountCents - contributionDistributionCents;
      if (rothTaxableCents > 0 && !isAtLeastAge59AndHalf(ownerBirthDate(input.people ?? [], account), input.date)) {
        earlyPenaltyCents = Math.round(rothTaxableCents * 1_000 / 10_000);
      }
    }

    sources.push({
      accountId,
      amountCents,
      taxableGainCents,
      ordinaryIncomeCents,
      rothTaxableCents,
      earlyPenaltyCents,
    });
  }

  const fundedCents = input.amountCents - remainingCents;
  return {
    fundedCents,
    unfundedCents: remainingCents,
    balances,
    taxableBasis,
    rothContributionBasis,
    sources,
    taxableGainCents: sources.reduce((total, source) => total + source.taxableGainCents, 0),
    ordinaryIncomeCents: sources.reduce((total, source) => total + source.ordinaryIncomeCents, 0),
    rothTaxableCents: sources.reduce((total, source) => total + source.rothTaxableCents, 0),
    earlyPenaltyCents: sources.reduce((total, source) => total + source.earlyPenaltyCents, 0),
  };
};
