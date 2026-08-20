import type { BasisPoints } from "./types";

export interface RetirementSettingsRecord {
  householdId: string;
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  revision: number;
}

export type RetirementSettingsInput = Omit<
  RetirementSettingsRecord,
  "householdId" | "revision"
> & {
  expectedRevision: number;
};

const januaryNextYear = (now: Date) => `${now.getUTCFullYear() + 1}-01`;

export const defaultRetirementSettings = (
  now = new Date(),
): Omit<RetirementSettingsRecord, "householdId"> => ({
  retirementMonth: januaryNextYear(now),
  withdrawalRateBps: 300,
  revision: 1,
});

export function normalizeRetirementSettings(
  value: unknown,
  now = new Date(),
): Omit<RetirementSettingsRecord, "householdId"> {
  const row = (value ?? {}) as Record<string, unknown>;
  const legacyYear = Number(row.retirementYear);
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
    revision: Number.isInteger(row.revision) ? Number(row.revision) : 1,
  };
}
