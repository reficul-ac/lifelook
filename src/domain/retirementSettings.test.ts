import { describe, expect, it } from "vitest";
import {
  normalizeRetirementSettings,
  type RetirementSettingsRecord,
} from "./retirementSettings";
import type { Account } from "./types";

const taxable = {
  id: "brokerage",
  name: "Brokerage",
  kind: "investment",
  subtype: "taxable-brokerage",
  balanceCents: 1_000_000,
  annualReturnBps: 600,
  liquid: true,
} satisfies Account;

const taxable2 = {
  ...taxable,
  id: "brokerage-2",
  name: "Second brokerage",
} satisfies Account;

const ira = {
  ...taxable,
  id: "ira",
  name: "IRA",
  subtype: "traditional-ira",
} satisfies Account;

describe("retirement settings normalization", () => {
  // Break caught: omitting migration defaults would leave a new retirement plan without a usable horizon, scenario, or taxable destination.
  it("defaults a missing record and selects its sole taxable investment account", () => {
    expect(normalizeRetirementSettings(null, [taxable])).toMatchObject({
      withdrawalRateBps: 300,
      horizonYears: 30,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
    });
  });

  // Break caught: a legacy saved plan with no new fields would incorrectly choose between multiple taxable destinations instead of requiring an explicit choice.
  it("migrates a legacy record without choosing among multiple taxable accounts", () => {
    const legacy = {
      householdId: "household",
      retirementYear: 2040,
      withdrawalRateBps: 400,
      revision: 3,
    };

    expect(
      normalizeRetirementSettings(
        legacy as unknown as RetirementSettingsRecord,
        [taxable, taxable2],
      ),
    ).toMatchObject({
      horizonYears: 30,
      taxableDestinationAccountId: null,
    });
  });

  // Break caught: accepting an out-of-range projection horizon would permit an invalid retirement projection duration.
  it("replaces an out-of-range horizon with the safe default", () => {
    const record: RetirementSettingsRecord = {
      householdId: "household",
      retirementMonth: "2040-01",
      withdrawalRateBps: 400,
      horizonYears: 61,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      revision: 3,
    };

    expect(normalizeRetirementSettings(record, [taxable])).toMatchObject({
      horizonYears: 30,
    });
  });

  // Break caught: retaining deleted or repeated withdrawal accounts would produce a stale manual withdrawal sequence instead of automatic ordering.
  it("filters unknown and duplicate withdrawal account IDs while preserving known order", () => {
    const record: RetirementSettingsRecord = {
      householdId: "household",
      retirementMonth: "2040-01",
      withdrawalRateBps: 400,
      horizonYears: 25,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: ["ira", "missing", "brokerage", "ira"],
      selectedScenario: "sell-all-homes",
      revision: 3,
    };

    expect(normalizeRetirementSettings(record, [taxable, ira])).toMatchObject({
      withdrawalAccountOrder: ["ira", "brokerage"],
    });
  });

  // Break caught: an unsupported persisted scenario would flow into projection code rather than falling back to the supported default.
  it("defaults an invalid saved scenario while preserving valid saved settings", () => {
    const record = {
      householdId: "household",
      retirementMonth: "2040-01",
      withdrawalRateBps: 400,
      horizonYears: 25,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: ["ira"],
      selectedScenario: "unknown",
      revision: 3,
    } as unknown as RetirementSettingsRecord;

    expect(normalizeRetirementSettings(record, [taxable, ira])).toMatchObject({
      retirementMonth: "2040-01",
      withdrawalRateBps: 400,
      horizonYears: 25,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: ["ira"],
      selectedScenario: "keep-homes",
      revision: 3,
    });
  });
});
