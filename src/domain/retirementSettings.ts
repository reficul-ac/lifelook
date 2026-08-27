import type { Account, BasisPoints, Cents } from "./types";

export type RetirementScenario = "keep-homes" | "sell-all-homes";

export interface RetirementExpenseBucket {
  id: string;
  name: string;
  annualAmountCents: Cents;
}

export interface RetirementSettingsRecord {
  householdId: string;
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  horizonYears: number;
  taxableDestinationAccountId: string | null;
  withdrawalAccountOrder: readonly string[];
  selectedScenario: RetirementScenario;
  expenseBuckets?: readonly RetirementExpenseBucket[];
  revision: number;
}

export type NormalizedRetirementSettings = Omit<
  RetirementSettingsRecord,
  "householdId" | "expenseBuckets"
> & { expenseBuckets: readonly RetirementExpenseBucket[] };

export type RetirementSettingsInput = Omit<
  RetirementSettingsRecord,
  "householdId" | "revision" | "expenseBuckets"
> & {
  expenseBuckets: readonly RetirementExpenseBucket[];
  expectedRevision: number;
};

const januaryNextYear = (now: Date) => `${now.getUTCFullYear() + 1}-01`;

export const isTaxableInvestmentAccount = (account: Account) =>
  account.kind === "investment" &&
  (account.subtype == null || account.subtype === "taxable-brokerage");

export const defaultRetirementSettings = (
  now = new Date(),
): NormalizedRetirementSettings => ({
  retirementMonth: januaryNextYear(now),
  withdrawalRateBps: 300,
  horizonYears: 30,
  taxableDestinationAccountId: null,
  withdrawalAccountOrder: [],
  selectedScenario: "keep-homes",
  expenseBuckets: [],
  revision: 1,
});

export function normalizeRetirementSettings(
  value: unknown,
  accounts: readonly Account[] = [],
  now = new Date(),
): NormalizedRetirementSettings {
  const row = (value ?? {}) as Record<string, unknown>;
  const legacyYear = Number(row.retirementYear);
  const taxableAccountIds = accounts
    .filter(isTaxableInvestmentAccount)
    .map((account) => account.id);
  const knownAccountIds = new Set(accounts.map((account) => account.id));
  const withdrawalAccountOrderIds = new Set<string>();
  const isKnownUniqueAccountId = (accountId: unknown): accountId is string => {
    if (
      typeof accountId !== "string" ||
      !knownAccountIds.has(accountId) ||
      withdrawalAccountOrderIds.has(accountId)
    )
      return false;
    withdrawalAccountOrderIds.add(accountId);
    return true;
  };
  const withdrawalAccountOrder = Array.isArray(row.withdrawalAccountOrder)
    ? row.withdrawalAccountOrder.filter(isKnownUniqueAccountId)
    : [];
  const expenseBucketIds = new Set<string>();
  const expenseBuckets = Array.isArray(row.expenseBuckets)
    ? row.expenseBuckets.flatMap((candidate) => {
        const bucket = candidate as Record<string, unknown>;
        const id = typeof bucket.id === "string" ? bucket.id.trim() : "";
        const name = typeof bucket.name === "string" ? bucket.name.trim() : "";
        const annualAmountCents = Number(bucket.annualAmountCents);
        if (
          id === "" ||
          name === "" ||
          expenseBucketIds.has(id) ||
          !Number.isSafeInteger(annualAmountCents) ||
          annualAmountCents < 0
        ) return [];
        expenseBucketIds.add(id);
        return [{ id, name, annualAmountCents }];
      })
    : [];

  return {
    retirementMonth:
      typeof row.retirementMonth === "string"
        ? row.retirementMonth
        : Number.isInteger(legacyYear)
          ? `${legacyYear}-01`
          : januaryNextYear(now),
    withdrawalRateBps: Number.isInteger(row.withdrawalRateBps)
      ? Number(row.withdrawalRateBps)
      : 300,
    horizonYears:
      Number.isInteger(row.horizonYears) &&
      Number(row.horizonYears) >= 1 &&
      Number(row.horizonYears) <= 60
        ? Number(row.horizonYears)
        : 30,
    taxableDestinationAccountId:
      typeof row.taxableDestinationAccountId === "string" &&
      taxableAccountIds.includes(row.taxableDestinationAccountId)
        ? row.taxableDestinationAccountId
        : taxableAccountIds.length === 1
          ? taxableAccountIds[0]
          : null,
    withdrawalAccountOrder,
    selectedScenario:
      row.selectedScenario === "sell-all-homes" ? "sell-all-homes" : "keep-homes",
    expenseBuckets,
    revision: Number.isInteger(row.revision) ? Number(row.revision) : 1,
  };
}
