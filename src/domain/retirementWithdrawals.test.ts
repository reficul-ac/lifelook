import { describe, expect, it } from "vitest";
import {
  ageOnDate,
  defaultRetirementAccountOrder,
  drawRetirementFunds,
  isAtLeastAge59AndHalf,
  resolveRetirementAccountOrder,
} from "./index";
import type { Account, FinancialSnapshot } from "./types";

const account = (value: Partial<Account> & Pick<Account, "id" | "name" | "kind">): Account => ({
  balanceCents: 100_000,
  annualReturnBps: 0,
  liquid: true,
  ...value,
});

const snapshot = (accounts: readonly Account[]): FinancialSnapshot => ({
  household: {
    id: "household",
    name: "Household",
    people: [
      { id: "owner", name: "Owner", birthDate: "1970-07-02" },
      { id: "missing-birth-date", name: "Unknown age" },
    ],
    state: "CA",
  },
  taxProfile: {
    filingStatus: "single",
    state: "CA",
    taxYear: 2026,
    thresholdInflationBps: 0,
  },
  accounts,
  recurring: [],
  assets: [],
  liabilities: [],
});

const accounts = [
  account({
    id: "brokerage",
    name: "Brokerage",
    kind: "investment",
    subtype: "taxable-brokerage",
  }),
  account({ id: "checking", name: "Checking", kind: "checking", subtype: "cash" }),
  account({
    id: "401k",
    name: "401(k)",
    kind: "retirement",
    subtype: "employer-pre-tax",
    ownerPersonId: "owner",
  }),
  account({
    id: "roth",
    name: "Roth IRA",
    kind: "retirement",
    subtype: "roth-ira",
    ownerPersonId: "owner",
  }),
] as const;

describe("age-aware retirement withdrawal ordering", () => {
  // Break caught: subtracting calendar years without checking the birthday would overstate the displayed age before the birthday.
  it("calculates age on the exact birthday boundary", () => {
    expect(ageOnDate("1970-07-02", "2030-01-01")).toBe(59);
  });

  // Break caught: treating the day before the half-birthday as eligible would remove the early-distribution penalty classification too soon.
  it("makes pre-tax distributions eligible only on the exact 59-and-a-half date", () => {
    expect(isAtLeastAge59AndHalf("1970-07-02", "2030-01-01")).toBe(false);
    expect(isAtLeastAge59AndHalf("1970-07-02", "2030-01-02")).toBe(true);
  });

  // Break caught: placing penalty-sensitive retirement accounts before taxable or cash accounts would cause premature early distributions.
  it("orders taxable and cash accounts before penalty-sensitive pre-tax accounts while keeping Roth last", () => {
    expect(defaultRetirementAccountOrder(snapshot(accounts), "2029-01-01")).toEqual([
      "brokerage",
      "checking",
      "401k",
      "roth",
    ]);
  });

  // Break caught: failing to move an age-eligible pre-tax account ahead of cash would retain an unnecessary cash-first withdrawal order after age 59-and-a-half.
  it("moves age-eligible pre-tax accounts ahead of cash while preserving source order in each class", () => {
    const taxableSecond = account({
      id: "brokerage-2",
      name: "Second brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
    });
    const unknownAgeIra = account({
      id: "unknown-age-ira",
      name: "Unknown-age IRA",
      kind: "retirement",
      subtype: "traditional-ira",
      ownerPersonId: "missing-birth-date",
    });

    expect(defaultRetirementAccountOrder(snapshot([
      accounts[0],
      taxableSecond,
      accounts[1],
      accounts[2],
      unknownAgeIra,
      accounts[3],
    ]), "2030-01-02")).toEqual([
      "brokerage",
      "brokerage-2",
      "401k",
      "checking",
      "unknown-age-ira",
      "roth",
    ]);
  });

  // Break caught: honoring duplicate or unknown override IDs, or failing to append omitted accounts, would create an invalid or incomplete draw sequence.
  it("uses unique valid overrides first and completes them with automatic order", () => {
    expect(resolveRetirementAccountOrder(
      snapshot(accounts),
      "2029-01-01",
      ["401k", "missing", "401k"],
    )).toEqual([
      "401k",
      "brokerage",
      "checking",
      "roth",
    ]);
  });
});

describe("retirement fund draws", () => {
  // Break caught: subtracting the full taxable cost basis on a partial sale would understate the taxable gain and leave the remaining basis wrong.
  it("depletes a taxable account partially and reduces its cost basis proportionally", () => {
    const brokerage = account({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 60_000,
    });

    expect(drawRetirementFunds({
      amountCents: 50_000,
      date: "2030-01-01",
      order: ["brokerage"],
      accounts: [brokerage],
      balances: { brokerage: 100_000 },
    })).toMatchObject({
      fundedCents: 50_000,
      unfundedCents: 0,
      balances: { brokerage: 50_000 },
      taxableBasis: { brokerage: 30_000 },
      taxableGainCents: 20_000,
      sources: [{
        accountId: "brokerage",
        amountCents: 50_000,
        taxableGainCents: 20_000,
        ordinaryIncomeCents: 0,
        rothTaxableCents: 0,
        earlyPenaltyCents: 0,
      }],
    });
  });

  // Break caught: stopping after the first depleted account or omitting the 10% penalty would leave a fundable draw uncovered or understate an early pre-tax distribution.
  it("falls back across accounts and records ordinary income with an early pre-tax penalty", () => {
    const brokerage = account({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 60_000,
    });
    const preTax = account({
      id: "401k",
      name: "401(k)",
      kind: "retirement",
      subtype: "employer-pre-tax",
      ownerPersonId: "owner",
    });

    expect(drawRetirementFunds({
      amountCents: 150_000,
      date: "2030-01-01",
      order: ["brokerage", "401k"],
      accounts: [brokerage, preTax],
      balances: { brokerage: 100_000, "401k": 100_000 },
    })).toMatchObject({
      fundedCents: 150_000,
      unfundedCents: 0,
      ordinaryIncomeCents: 50_000,
      earlyPenaltyCents: 5_000,
      balances: { brokerage: 0, "401k": 50_000 },
    });
  });

  // Break caught: treating all Roth withdrawals as taxable before consuming contribution basis would tax principal that has already been contributed.
  it("uses Roth contribution basis before taxable earnings", () => {
    const roth = account({
      id: "roth",
      name: "Roth IRA",
      kind: "retirement",
      subtype: "roth-ira",
      rothContributionBasisCents: 60_000,
    });

    expect(drawRetirementFunds({
      amountCents: 80_000,
      date: "2030-01-01",
      order: ["roth"],
      accounts: [roth],
      balances: { roth: 100_000 },
    })).toMatchObject({
      balances: { roth: 20_000 },
      rothContributionBasis: { roth: 0 },
      rothTaxableCents: 20_000,
      earlyPenaltyCents: 2_000,
      sources: [{
        accountId: "roth",
        amountCents: 80_000,
        taxableGainCents: 0,
        ordinaryIncomeCents: 0,
        rothTaxableCents: 20_000,
        earlyPenaltyCents: 2_000,
      }],
    });
  });

  // Break caught: reporting a requested amount as funded when ordered balances are exhausted would hide an uncovered retirement spending need.
  it("reports the amount left uncovered after all ordered balances are depleted", () => {
    const cash = account({ id: "cash", name: "Cash", kind: "checking", subtype: "cash" });

    expect(drawRetirementFunds({
      amountCents: 150_000,
      date: "2030-01-01",
      order: ["cash"],
      accounts: [cash],
      balances: { cash: 100_000 },
    })).toMatchObject({
      fundedCents: 100_000,
      unfundedCents: 50_000,
      balances: { cash: 0 },
      sources: [{
        accountId: "cash",
        amountCents: 100_000,
        taxableGainCents: 0,
        ordinaryIncomeCents: 0,
        rothTaxableCents: 0,
        earlyPenaltyCents: 0,
      }],
    });
  });

  // Break caught: retaining an early-withdrawal penalty after the owner reaches 59-and-a-half would overstate retirement tax costs.
  it("does not penalize a pre-tax distribution at age 59-and-a-half", () => {
    const preTax = account({
      id: "401k",
      name: "401(k)",
      kind: "retirement",
      subtype: "employer-pre-tax",
      ownerPersonId: "owner",
    });

    expect(drawRetirementFunds({
      amountCents: 50_000,
      date: "2030-01-02",
      order: ["401k"],
      accounts: [preTax],
      balances: { "401k": 100_000 },
      people: snapshot([]).household.people,
    })).toMatchObject({
      ordinaryIncomeCents: 50_000,
      earlyPenaltyCents: 0,
    });
  });
});
