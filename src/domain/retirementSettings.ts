import type { Account, BasisPoints } from "./types";

export type RetirementScenario = "keep-homes" | "sell-all-homes";

export interface RetirementSettingsRecord {
  householdId: string;
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  horizonYears: number;
  taxableDestinationAccountId: string | null;
  withdrawalAccountOrder: readonly string[];
  selectedScenario: RetirementScenario;
  revision: number;
}

export type NormalizedRetirementSettings = Omit<
  RetirementSettingsRecord,
  "householdId"
>;

export type RetirementSettingsInput = Omit<
  RetirementSettingsRecord,
  "householdId" | "revision"
> & {
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
    revision: Number.isInteger(row.revision) ? Number(row.revision) : 1,
  };
}
