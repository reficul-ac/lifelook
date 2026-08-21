import { describe, expect, it } from "vitest";
import {
  ageOnDate,
  defaultRetirementAccountOrder,
  drawRetirementFunds,
  isAtLeastAge59AndHalf,
  isRetirementDrawableAccount,
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

  // Break caught: using a strictly-before birthday comparison would leave display age one year too low on the person's actual birthday.
  it("increments display age on the actual birthday", () => {
    expect(ageOnDate("1970-07-02", "2030-07-02")).toBe(60);
  });

  // Break caught: silently normalizing a February 29 birthday to February 28 would increment display age before the calendar anniversary exists in a non-leap year.
  it("keeps February 29 display age below the next year until March 1 in a non-leap year", () => {
    expect(ageOnDate("1964-02-29", "2023-02-28")).toBe(58);
    expect(ageOnDate("1964-02-29", "2023-03-01")).toBe(59);
  });

  // Break caught: treating the day before the half-birthday as eligible would remove the early-distribution penalty classification too soon.
  it("makes pre-tax distributions eligible only on the exact 59-and-a-half date", () => {
    expect(isAtLeastAge59AndHalf("1970-07-02", "2030-01-01")).toBe(false);
    expect(isAtLeastAge59AndHalf("1970-07-02", "2030-01-02")).toBe(true);
  });

  // Break caught: letting native month arithmetic overflow August 29-31 half-birthdays into March would delay eligibility past February's final calendar day.
  it("clamps August 29-31 half-birthdays to February's last day in leap and non-leap years", () => {
    const cases = [
      ["1970-08-29", "2030-02-27", "2030-02-28", "2030-03-01"],
      ["1970-08-30", "2030-02-27", "2030-02-28", "2030-03-01"],
      ["1970-08-31", "2030-02-27", "2030-02-28", "2030-03-01"],
      ["1972-08-29", "2032-02-28", "2032-02-29", "2032-03-01"],
      ["1972-08-30", "2032-02-28", "2032-02-29", "2032-03-01"],
      ["1972-08-31", "2032-02-28", "2032-02-29", "2032-03-01"],
    ] as const;

    for (const [birthDate, before, on, after] of cases) {
      expect(isAtLeastAge59AndHalf(birthDate, before)).toBe(false);
      expect(isAtLeastAge59AndHalf(birthDate, on)).toBe(true);
      expect(isAtLeastAge59AndHalf(birthDate, after)).toBe(true);
    }
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

  // Production mutations caught: treating every account balance as spendable would
  // put credit debt into the withdrawal order and inflate the eligible portfolio.
  it("centralizes drawability and excludes credit accounts from automatic and overridden order", () => {
    const credit = account({
      id: "credit",
      name: "Credit card",
      kind: "credit",
      balanceCents: -50_000,
    });
    const withCredit = snapshot([...accounts, credit]);

    expect(isRetirementDrawableAccount(credit)).toBe(false);
    expect(isRetirementDrawableAccount(accounts[0])).toBe(true);
    expect(defaultRetirementAccountOrder(withCredit, "2030-01-01"))
      .not.toContain("credit");
    expect(resolveRetirementAccountOrder(withCredit, "2030-01-01", ["credit", "roth"]))
      .not.toContain("credit");
  });

  // Break caught: consulting account kind after an explicit subtype would classify taxable brokerage balances as cash or penalty-sensitive pre-tax solely because of a conflicting legacy kind.
  it("uses explicit subtype before account kind in both ordering and draw tax treatment", () => {
    const retirementTaxable = account({
      id: "retirement-taxable",
      name: "Taxable retirement-kind account",
      kind: "retirement",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 60_000,
    });
    const checkingTaxable = account({
      id: "checking-taxable",
      name: "Taxable checking-kind account",
      kind: "checking",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 25_000,
    });
    const cash = account({ id: "cash", name: "Cash", kind: "checking", subtype: "cash" });
    const conflictedAccounts = [retirementTaxable, checkingTaxable, cash];

    expect(defaultRetirementAccountOrder(snapshot(conflictedAccounts), "2030-01-01")).toEqual([
      "retirement-taxable",
      "checking-taxable",
      "cash",
    ]);
    expect(drawRetirementFunds({
      amountCents: 150_000,
      date: "2030-01-01",
      order: ["retirement-taxable", "checking-taxable", "cash"],
      accounts: conflictedAccounts,
      balances: {
        "retirement-taxable": 100_000,
        "checking-taxable": 100_000,
        cash: 100_000,
      },
    })).toMatchObject({
      taxableGainCents: 90_000,
      ordinaryIncomeCents: 0,
      earlyPenaltyCents: 0,
      taxableBasis: {
        "retirement-taxable": 0,
        "checking-taxable": 25_000,
      },
    });
  });

  // Break caught: falling back to conflicting account kinds for any retirement subtype would change its bucket or tax character, producing cash/taxable draws instead of the subtype's pre-tax or Roth treatment.
  it("uses every explicit retirement subtype over a conflicting account kind for ordering and draws", () => {
    const traditionalIra = account({
      id: "traditional-ira",
      name: "Traditional IRA in checking kind",
      kind: "checking",
      subtype: "traditional-ira",
      ownerPersonId: "older",
    });
    const employerPreTax = account({
      id: "employer-pre-tax",
      name: "Employer pre-tax in investment kind",
      kind: "investment",
      subtype: "employer-pre-tax",
      ownerPersonId: "younger",
    });
    const rothIra = account({
      id: "roth-ira",
      name: "Roth IRA in checking kind",
      kind: "checking",
      subtype: "roth-ira",
      ownerPersonId: "younger",
      rothContributionBasisCents: 60_000,
      rothOpeningYear: 2020,
    });
    const employerRoth = account({
      id: "employer-roth",
      name: "Employer Roth in investment kind",
      kind: "investment",
      subtype: "employer-roth",
      ownerPersonId: "older",
      rothContributionBasisCents: 60_000,
      rothOpeningYear: 2028,
    });
    const cash = account({ id: "cash", name: "Cash", kind: "checking", subtype: "cash" });
    const conflictedAccounts = [traditionalIra, employerPreTax, rothIra, employerRoth, cash];
    const conflictingSnapshot = snapshot(conflictedAccounts);
    const people = [
      { id: "older", name: "Older", birthDate: "1969-01-01" },
      { id: "younger", name: "Younger", birthDate: "1970-07-02" },
    ];

    expect(defaultRetirementAccountOrder({
      ...conflictingSnapshot,
      household: { ...conflictingSnapshot.household, people },
    }, "2030-01-01")).toEqual([
      "traditional-ira",
      "cash",
      "employer-pre-tax",
      "roth-ira",
      "employer-roth",
    ]);
    expect(drawRetirementFunds({
      amountCents: 400_000,
      date: "2030-01-01",
      order: ["traditional-ira", "employer-pre-tax", "roth-ira", "employer-roth"],
      accounts: conflictedAccounts,
      balances: {
        "traditional-ira": 100_000,
        "employer-pre-tax": 100_000,
        "roth-ira": 100_000,
        "employer-roth": 100_000,
        cash: 100_000,
      },
      people,
    })).toMatchObject({
      ordinaryIncomeCents: 200_000,
      rothTaxableCents: 80_000,
      earlyPenaltyCents: 14_000,
      sources: [
        expect.objectContaining({ accountId: "traditional-ira", ordinaryIncomeCents: 100_000, earlyPenaltyCents: 0 }),
        expect.objectContaining({ accountId: "employer-pre-tax", ordinaryIncomeCents: 100_000, earlyPenaltyCents: 10_000 }),
        expect.objectContaining({ accountId: "roth-ira", rothTaxableCents: 40_000, earlyPenaltyCents: 4_000 }),
        expect.objectContaining({ accountId: "employer-roth", rothTaxableCents: 40_000, earlyPenaltyCents: 0 }),
      ],
    });
  });
});

describe("retirement fund draws", () => {
  // Production mutation caught: collapsing lots into one aggregate basis reports every brokerage gain as exact long-term gain and loses California basis differences.
  it("returns FIFO holding-period and jurisdiction character with the remaining lots", () => {
    const brokerage = account({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      balanceCents: 100_000,
      taxLots: [
        { id: "recent", acquiredOn: "2029-12-01", marketValueCents: 50_000, federalBasisCents: 25_000, californiaBasisCents: 30_000 },
        { id: "old", acquiredOn: "2020-01-01", marketValueCents: 50_000, federalBasisCents: 40_000, californiaBasisCents: 35_000 },
      ],
    });

    const result = drawRetirementFunds({
      amountCents: 75_000,
      date: "2030-01-02",
      order: ["brokerage"],
      accounts: [brokerage],
      balances: { brokerage: 100_000 },
      taxableLots: { brokerage: brokerage.taxLots! },
    });

    expect(result.sources[0]).toMatchObject({
      taxYear: 2030,
      taxableGainCents: 22_500,
      federalShortTermGainCents: 12_500,
      federalLongTermGainCents: 10_000,
      californiaGainCents: 25_000,
      taxCharacterSupported: true,
    });
    expect(result.taxableLots).toEqual({
      brokerage: [{
        id: "recent",
        acquiredOn: "2029-12-01",
        marketValueCents: 25_000,
        federalBasisCents: 12_500,
        californiaBasisCents: 15_000,
      }],
    });
  });

  // Production mutation caught: allocating aggregate basis proportionally to a
  // partial brokerage sale claims unsupported lot selection and may understate tax.
  it("retains aggregate basis on a partial sale and conservatively treats proceeds as short-term gain", () => {
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
      taxableBasis: { brokerage: 60_000 },
      taxableGainCents: 50_000,
      sources: [{
        accountId: "brokerage",
        amountCents: 50_000,
        taxableGainCents: 50_000,
        ordinaryIncomeCents: 0,
        rothTaxableCents: 0,
        earlyPenaltyCents: 0,
      }],
    });
  });

  // Production mutations caught: rejecting persisted aggregate basis makes every
  // funded production brokerage unavailable, while calling its gain long-term
  // would claim a holding period the persisted record does not contain.
  it("uses disclosed conservative short-term treatment for a supported aggregate-basis draw", () => {
    const brokerage = account({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 100_000,
    });

    const result = drawRetirementFunds({
      amountCents: 50_000,
      date: "2030-01-01",
      order: ["brokerage"],
      accounts: [brokerage],
      balances: { brokerage: 100_000 },
    });

    expect(result.sources[0]).toMatchObject({
      amountCents: 50_000,
      taxableGainCents: 50_000,
      federalShortTermGainCents: 50_000,
      federalLongTermGainCents: 0,
      californiaGainCents: 50_000,
      taxEstimateMethod: "conservative-aggregate-basis",
      taxCharacterSupported: true,
    });
    expect(result.taxCharacterSupported).toBe(true);
  });

  // Production mutation caught: assuming zero basis when no basis was persisted
  // fabricates taxable gain instead of identifying the unsupported fact.
  it("keeps a funded taxable draw unsupported when aggregate basis is missing", () => {
    const brokerage = account({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: null,
    });

    expect(drawRetirementFunds({
      amountCents: 50_000,
      date: "2030-01-01",
      order: ["brokerage"],
      accounts: [brokerage],
      balances: { brokerage: 100_000 },
    }).sources[0]).toMatchObject({
      taxEstimateMethod: "unsupported",
      taxCharacterSupported: false,
    });
  });

  // Production mutation caught: inferring zero gain from equal aggregate basis loses the first FIFO lot's gain when an offsetting loss is held in a later lot.
  it("uses exact FIFO lots for a partial draw from a mixed gain-loss account", () => {
    const brokerage = account({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 100_000,
      taxLots: [
        { id: "gain-lot", acquiredOn: "2020-01-01", marketValueCents: 50_000, federalBasisCents: 25_000, californiaBasisCents: 25_000 },
        { id: "loss-lot", acquiredOn: "2021-01-01", marketValueCents: 50_000, federalBasisCents: 75_000, californiaBasisCents: 75_000 },
      ],
    });

    const result = drawRetirementFunds({
      amountCents: 50_000,
      date: "2030-01-01",
      order: ["brokerage"],
      accounts: [brokerage],
      balances: { brokerage: 100_000 },
      taxableLots: { brokerage: brokerage.taxLots! },
    });

    expect(result.sources[0]).toMatchObject({
      amountCents: 50_000,
      taxableGainCents: 25_000,
      federalLongTermGainCents: 25_000,
      californiaGainCents: 25_000,
      taxCharacterSupported: true,
    });
    expect(result.taxableLots).toEqual({ brokerage: [brokerage.taxLots![1]] });
  });

  // Break caught: mutating caller-owned balance or basis records while drawing would corrupt the projection state that supplied this pure calculation.
  it("returns updated draw state without mutating retained input records", () => {
    const brokerage = account({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 67,
    });
    const balances = { brokerage: 101 };
    const taxableBasis = { brokerage: 67 };

    const result = drawRetirementFunds({
      amountCents: 50,
      date: "2030-01-01",
      order: ["brokerage"],
      accounts: [brokerage],
      balances,
      taxableBasis,
    });

    expect(balances).toEqual({ brokerage: 101 });
    expect(taxableBasis).toEqual({ brokerage: 67 });
    expect(result).toMatchObject({
      balances: { brokerage: 51 },
      taxableBasis: { brokerage: 67 },
      taxableGainCents: 50,
    });
  });

  // Production mutation caught: retaining aggregate basis after final liquidation
  // would fabricate a future tax shield; recognizing the resulting modeled loss
  // would exceed the conservative model's supported capital-loss scope.
  it("clears aggregate basis on full depletion without claiming a capital loss", () => {
    const brokerage = account({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 67,
    });
    const partial = drawRetirementFunds({
      amountCents: 50,
      date: "2030-01-01",
      order: ["brokerage"],
      accounts: [brokerage],
      balances: { brokerage: 101 },
    });

    expect(partial).toMatchObject({
      balances: { brokerage: 51 },
      taxableBasis: { brokerage: 67 },
      taxableGainCents: 50,
    });
    expect(drawRetirementFunds({
      amountCents: 51,
      date: "2030-01-01",
      order: ["brokerage"],
      accounts: [brokerage],
      balances: partial.balances,
      taxableBasis: partial.taxableBasis,
    })).toMatchObject({
      balances: { brokerage: 0 },
      taxableBasis: { brokerage: 0 },
      taxableGainCents: 0,
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
      ownerPersonId: "owner",
      rothContributionBasisCents: 60_000,
      rothOpeningYear: 2020,
    });

    expect(drawRetirementFunds({
      amountCents: 80_000,
      date: "2030-01-01",
      order: ["roth"],
      accounts: [roth],
      balances: { roth: 100_000 },
      people: snapshot([]).household.people,
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

  // Production mutation caught: age alone is insufficient for a qualified Roth
  // distribution; both owner age and the account's five-tax-year period matter.
  it("treats Roth IRA earnings as tax-free only after age 59½ and five tax years", () => {
    const roth = account({
      id: "roth",
      name: "Roth IRA",
      kind: "retirement",
      subtype: "roth-ira",
      ownerPersonId: "older",
      rothContributionBasisCents: 60_000,
      rothOpeningYear: 2020,
    });
    const people = [{ id: "older", name: "Older", birthDate: "1960-01-01" }];

    expect(drawRetirementFunds({
      amountCents: 80_000,
      date: "2030-12-31",
      order: ["roth"],
      accounts: [roth],
      balances: { roth: 100_000 },
      people,
    }).sources[0]).toMatchObject({
      rothTaxableCents: 0,
      earlyPenaltyCents: 0,
      taxEstimateMethod: "qualified-roth",
      taxCharacterSupported: true,
    });

    expect(drawRetirementFunds({
      amountCents: 80_000,
      date: "2023-12-31",
      order: ["roth"],
      accounts: [{ ...roth, rothOpeningYear: 2022 }],
      balances: { roth: 100_000 },
      people,
    }).sources[0]).toMatchObject({
      rothTaxableCents: 20_000,
      earlyPenaltyCents: 0,
      taxEstimateMethod: "unqualified-roth-ira",
      taxCharacterSupported: true,
    });
  });

  // Production mutation caught: employer Roth distributions are pro-rata rather
  // than Roth-IRA contribution-first when the distribution is not qualified.
  it("uses pro-rata basis for an unqualified employer Roth distribution", () => {
    const employerRoth = account({
      id: "employer-roth",
      name: "Employer Roth",
      kind: "retirement",
      subtype: "employer-roth",
      ownerPersonId: "owner",
      rothContributionBasisCents: 60_000,
      rothOpeningYear: 2028,
    });

    expect(drawRetirementFunds({
      amountCents: 50_000,
      date: "2030-01-01",
      order: ["employer-roth"],
      accounts: [employerRoth],
      balances: { "employer-roth": 100_000 },
      people: snapshot([]).household.people,
    })).toMatchObject({
      rothContributionBasis: { "employer-roth": 30_000 },
      rothTaxableCents: 20_000,
      earlyPenaltyCents: 2_000,
      sources: [expect.objectContaining({
        taxEstimateMethod: "unqualified-employer-roth",
        taxCharacterSupported: true,
      })],
    });
  });

  // Production mutation caught: guessing qualification when opening year or owner
  // birth date is absent turns unsupported Roth earnings into precise tax output.
  it("returns unsupported tax character when Roth qualification facts are missing", () => {
    const missingOpening = account({
      id: "missing-opening",
      name: "Roth IRA missing opening year",
      kind: "retirement",
      subtype: "roth-ira",
      ownerPersonId: "owner",
      rothContributionBasisCents: 10_000,
    });
    const missingBirth = account({
      ...missingOpening,
      id: "missing-birth",
      name: "Roth IRA missing birth date",
      ownerPersonId: "missing-birth-date",
      rothOpeningYear: 2020,
    });
    const result = drawRetirementFunds({
      amountCents: 200_000,
      date: "2030-12-31",
      order: ["missing-opening", "missing-birth"],
      accounts: [missingOpening, missingBirth],
      balances: { "missing-opening": 100_000, "missing-birth": 100_000 },
      people: snapshot([]).household.people,
    });

    expect(result.taxCharacterSupported).toBe(false);
    expect(result.sources).toEqual([
      expect.objectContaining({
        accountId: "missing-opening",
        taxEstimateMethod: "unsupported",
        taxCharacterSupported: false,
      }),
      expect.objectContaining({
        accountId: "missing-birth",
        taxEstimateMethod: "unsupported",
        taxCharacterSupported: false,
      }),
    ]);
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

  // Break caught: applying one household age to every account would omit the younger owner's penalty or add one for the older owner's eligible distribution.
  it("uses each pre-tax account's own owner's age for the early penalty", () => {
    const olderPreTax = account({
      id: "older-401k",
      name: "Older owner's 401(k)",
      kind: "retirement",
      subtype: "employer-pre-tax",
      ownerPersonId: "older",
    });
    const youngerPreTax = account({
      id: "younger-401k",
      name: "Younger owner's 401(k)",
      kind: "retirement",
      subtype: "employer-pre-tax",
      ownerPersonId: "younger",
    });

    expect(drawRetirementFunds({
      amountCents: 200_000,
      date: "2030-01-01",
      order: ["older-401k", "younger-401k"],
      accounts: [olderPreTax, youngerPreTax],
      balances: { "older-401k": 100_000, "younger-401k": 100_000 },
      people: [
        { id: "older", name: "Older", birthDate: "1969-01-01" },
        { id: "younger", name: "Younger", birthDate: "1970-07-02" },
      ],
    })).toMatchObject({
      ordinaryIncomeCents: 200_000,
      earlyPenaltyCents: 10_000,
      sources: [
        expect.objectContaining({ accountId: "older-401k", earlyPenaltyCents: 0 }),
        expect.objectContaining({ accountId: "younger-401k", earlyPenaltyCents: 10_000 }),
      ],
    });
  });
});
