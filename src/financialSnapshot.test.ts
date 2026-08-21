import { describe, expect, it } from "vitest";
import { drawRetirementFunds } from "./domain";
import { financialSnapshotFromBootstrap } from "./financialSnapshot";
import type { Bootstrap } from "./repository";

const bootstrap = (): Bootstrap => ({
  onboardingStep: 8,
  onboardingComplete: true,
  household: { id: "household", name: "Household", state: "CA" },
  people: [{
    id: "owner",
    householdId: "household",
    name: "Owner",
    birthDate: "1960-01-01",
  }],
  taxProfile: {
    filingStatus: "single",
    state: "CA",
    taxYear: 2026,
    thresholdInflationBps: 250,
    revision: 1,
  },
  settings: { theme: "system", reducedMotion: false, revision: 1 },
  accounts: [
    {
      id: "brokerage",
      householdId: "household",
      name: "Brokerage",
      kind: "investment",
      openingBalanceCents: 100_000,
      balanceCents: 100_000,
      annualReturnBps: 400,
      liquid: false,
      revision: 1,
      ownerPersonId: "owner",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 60_000,
    },
    {
      id: "pretax",
      householdId: "household",
      name: "401(k)",
      kind: "retirement",
      openingBalanceCents: 100_000,
      balanceCents: 100_000,
      annualReturnBps: 500,
      liquid: false,
      revision: 1,
      ownerPersonId: "owner",
      subtype: "employer-pre-tax",
    },
    {
      id: "roth",
      householdId: "household",
      name: "Roth IRA",
      kind: "retirement",
      openingBalanceCents: 100_000,
      balanceCents: 100_000,
      annualReturnBps: 600,
      liquid: false,
      revision: 1,
      ownerPersonId: "owner",
      subtype: "roth-ira",
      rothContributionBasisCents: 60_000,
      rothOpeningYear: 2020,
    },
  ],
  categories: [],
  activity: [],
  recurring: [],
  assets: [],
  liabilities: [],
  scenarios: [],
  retirementPlan: null,
});

describe("financialSnapshotFromBootstrap", () => {
  // Production mutations caught: dropping any persisted account tax/ownership field
  // changes the draw order or makes a funded production projection falsely unsupported.
  it("preserves funded taxable, pre-tax, and Roth metadata through the production adapter", () => {
    const snapshot = financialSnapshotFromBootstrap(bootstrap());

    expect(snapshot.accounts).toEqual([
      expect.objectContaining({
        id: "brokerage",
        ownerPersonId: "owner",
        subtype: "taxable-brokerage",
        taxableCostBasisCents: 60_000,
      }),
      expect.objectContaining({
        id: "pretax",
        ownerPersonId: "owner",
        subtype: "employer-pre-tax",
      }),
      expect.objectContaining({
        id: "roth",
        ownerPersonId: "owner",
        subtype: "roth-ira",
        rothContributionBasisCents: 60_000,
        rothOpeningYear: 2020,
      }),
    ]);

    const draw = drawRetirementFunds({
      amountCents: 300_000,
      date: "2030-12-31",
      order: ["brokerage", "pretax", "roth"],
      accounts: snapshot.accounts,
      balances: Object.fromEntries(snapshot.accounts.map((account) => [
        account.id,
        account.balanceCents,
      ])),
      people: snapshot.household.people,
    });

    expect(draw).toMatchObject({
      fundedCents: 300_000,
      unfundedCents: 0,
      federalShortTermGainCents: 40_000,
      ordinaryIncomeCents: 100_000,
      rothTaxableCents: 0,
      earlyPenaltyCents: 0,
      taxCharacterSupported: true,
    });
    expect(draw.sources).toEqual([
      expect.objectContaining({
        accountId: "brokerage",
        amountCents: 100_000,
        taxEstimateMethod: "conservative-aggregate-basis",
      }),
      expect.objectContaining({
        accountId: "pretax",
        amountCents: 100_000,
        ordinaryIncomeCents: 100_000,
      }),
      expect.objectContaining({
        accountId: "roth",
        amountCents: 100_000,
        rothTaxableCents: 0,
        taxEstimateMethod: "qualified-roth",
      }),
    ]);
  });
});
