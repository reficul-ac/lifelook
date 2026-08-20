import { describe, expect, it } from "vitest";
import { calculateRetirementSnapshot, type RetirementMissingData } from "./retirementSnapshot";
import { buildRetirementCutoff, type RetirementCutoff } from "./retirementCutoff";
import type { FinancialSnapshot, HomeSaleAssumptions, Scenario, TaxLedger } from "./types";

const completeTaxLedger = (overrides: Partial<TaxLedger> = {}): TaxLedger => ({
  year: 2026,
  employees: [],
  grossIncomeCents: 0,
  federalAgiCents: 0,
  modifiedAgiCents: 0,
  federalStandardCents: 0,
  federalItemizedCents: 0,
  federalDeductionCents: 0,
  federalTaxableCents: 0,
  californiaStandardCents: 0,
  californiaItemizedCents: 0,
  californiaDeductionCents: 0,
  californiaTaxableCents: 0,
  federalCents: 0,
  californiaCents: 0,
  socialSecurityCents: 0,
  medicareCents: 0,
  additionalMedicareCents: 0,
  sdiCents: 0,
  fullYearLiabilityCents: 0,
  futureCashFlowCents: 0,
  refundOrBalanceDue: "unknown",
  sources: [],
  projected: false,
  ...overrides,
});

const saleAssumptions = (
  overrides: Partial<HomeSaleAssumptions> = {},
): HomeSaleAssumptions => ({
  sellingCostBps: 500,
  primaryResidenceExclusionEligible: false,
  accumulatedFederalDepreciationCents: 0,
  accumulatedCaliforniaDepreciationCents: 0,
  ...overrides,
});

const baseScenario = (): Scenario => ({
  id: "plan",
  name: "Plan",
  assumptions: { inflationBps: 250, thresholdInflationBps: 250 },
  assumptionsInherited: false,
  events: [],
  defaultContributionAccountId: "cash",
  contributions: [],
  withdrawals: [],
  horizon: { start: "2026-01", months: 12 },
});

const baseSnapshot = (): FinancialSnapshot => ({
  household: {
    id: "household",
    name: "Household",
    state: "CA",
    people: [{ id: "person", name: "Person" }],
  },
  taxProfile: {
    filingStatus: "single",
    state: "CA",
    taxYear: 2026,
    thresholdInflationBps: 250,
    taxUnit: { id: "single", filingStatus: "single", memberPersonIds: ["person"] },
  },
  accounts: [
    { id: "cash", name: "Cash", kind: "checking", balanceCents: 1, annualReturnBps: 0, liquid: true },
    { id: "401k", name: "401(k)", kind: "retirement", balanceCents: 1, annualReturnBps: 0, liquid: false },
  ],
  recurring: [],
  assets: [
    {
      id: "rsu",
      name: "RSUs",
      valueCents: 50_000,
      annualGrowthBps: 0,
      equityHolding: {
        priceCents: 1_000,
        priceDate: "2026-01-01",
        sellToCover: true,
        grants: [{
          id: "grant",
          ownerPersonId: "person",
          grantDate: "2025-01-01",
          grantPriceCents: 1_000,
          unitsMicros: 50_000_000,
          vestEvents: [{ id: "future-vest", date: "2027-01-01", unitsMicros: 38_000_000 }],
        }],
      },
    },
    { id: "car", name: "Car", valueCents: 8_000, annualGrowthBps: 0 },
    {
      id: "home",
      name: "Home",
      valueCents: 200_000,
      annualGrowthBps: 0,
      purchaseDate: "2020-01-01",
      purchasePriceCents: 190_000,
      homeSaleAssumptions: saleAssumptions(),
      housingCosts: {
        propertyTaxRateBps: 0,
        insuranceMonthlyCents: 0,
        insuranceAnnualGrowthBps: 0,
        hoaMonthlyCents: 0,
        hoaAnnualGrowthBps: 0,
      },
    },
  ],
  liabilities: [
    {
      id: "mortgage",
      name: "Mortgage",
      balanceCents: 80_000,
      annualRateBps: 0,
      minimumPaymentCents: 0,
      mortgage: { originalPrincipalCents: 80_000, termMonths: 360, startDate: "2020-01-01", assetId: "home" },
    },
    { id: "card", name: "Card", balanceCents: 5_000, annualRateBps: 0, minimumPaymentCents: 0 },
  ],
});

const baseCutoff = (): RetirementCutoff => ({
  retirementMonth: "2026-07",
  balanceMonth: "2026-06",
  accounts: { cash: 10_000, "401k": 40_000 },
  assets: { rsu: 12_000, car: 8_000, home: 200_000 },
  liabilities: { mortgage: 80_000, card: 5_000 },
  properties: [{
    assetId: "home",
    name: "Home",
    valueCents: 200_000,
    liabilityId: "mortgage",
    mortgageCents: 80_000,
    monthlyGrossRentCents: 1_500,
    monthlyAduRentCents: 300,
    rentalUseBps: 10_000,
    projectedDepreciationCents: 0,
    source: "current",
  }],
  taxLedger: completeTaxLedger(),
});

interface Fixture {
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  cutoff: RetirementCutoff;
}

const fixture = (): Fixture => ({
  snapshot: baseSnapshot(),
  scenario: baseScenario(),
  cutoff: baseCutoff(),
});

const calculate = (value: Fixture, withdrawalRateBps = 300) =>
  calculateRetirementSnapshot({ ...value, withdrawalRateBps });

const currentHome = (value: Fixture) => {
  const home = value.snapshot.assets.find((asset) => asset.id === "home");
  if (!home) throw new Error("Home fixture is missing");
  return home;
};

it("carries the property liability linkage across the retirement cutoff boundary", () => {
  const cutoff = buildRetirementCutoff({
    snapshot: baseSnapshot(),
    scenario: baseScenario(),
    retirementMonth: "2026-03",
    asOfDate: "2026-01-15",
  });

  expect(cutoff.properties).toContainEqual(expect.objectContaining({
    assetId: "home",
    liabilityId: "mortgage",
    mortgageCents: 80_000,
  }));
});

it("resolves only the latest owned planned purchase after a sale and repurchase without mutating the Plan", () => {
  const value = fixture();
  value.snapshot.accounts = value.snapshot.accounts.map((account) =>
    account.id === "cash" ? { ...account, balanceCents: 1_000_000 } : account);
  value.snapshot.assets = value.snapshot.assets.filter((asset) => asset.id !== "home");
  value.snapshot.liabilities = value.snapshot.liabilities.filter((liability) => liability.id !== "mortgage");
  value.scenario.events = [
    {
      id: "old-purchase",
      date: "2026-01-01",
      type: "asset-purchase",
      assetId: "planned-home",
      name: "Old planned home",
      valueCents: 100_000,
      annualGrowthBps: 0,
      fundingAccountId: "cash",
      downPaymentCents: 50_000,
      costsCents: 0,
      financing: { liabilityId: "old-loan", name: "Old loan", principalCents: 50_000, annualRateBps: 0, minimumPaymentCents: 0 },
    },
    {
      id: "old-adu",
      date: "2026-02-01",
      type: "adu-build",
      assetId: "planned-home",
      name: "Old ADU",
      costCents: 0,
      homeSquareFeet: 1_000,
      aduSquareFeet: 100,
      fundingAccountId: "cash",
      monthlyRentalIncomeCents: 100,
      rentalIncomeGrowthBps: 0,
    },
    {
      id: "old-sale",
      date: "2026-03-01",
      type: "asset-sale",
      assetId: "planned-home",
      proceedsCents: 100_000,
      costsCents: 0,
      destinationAccountId: "cash",
      payoff: { liabilityId: "old-loan", mode: "full" },
    },
    {
      id: "new-purchase",
      date: "2026-04-01",
      type: "asset-purchase",
      assetId: "planned-home",
      name: "New planned home",
      valueCents: 200_000,
      annualGrowthBps: 0,
      fundingAccountId: "cash",
      downPaymentCents: 120_000,
      costsCents: 0,
      financing: { liabilityId: "new-loan", name: "New loan", principalCents: 80_000, annualRateBps: 0, minimumPaymentCents: 0 },
      propertyDetails: {
        primaryResidence: false,
        rentalUseBps: 10_000,
        rentalTaxModelingEnabled: true,
        buildingBasisCents: 33_000,
        homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0 }),
      },
    },
  ];
  const before = JSON.stringify(value.scenario);

  const cutoff = buildRetirementCutoff({
    snapshot: value.snapshot,
    scenario: value.scenario,
    retirementMonth: "2026-07",
    asOfDate: "2026-01-15",
  });

  expect(cutoff.properties).toEqual([expect.objectContaining({
    assetId: "planned-home",
    name: "New planned home",
    valueCents: 200_000,
    liabilityId: "new-loan",
    mortgageCents: 80_000,
    rentalUseBps: 10_000,
    projectedDepreciationCents: 300,
    source: "planned",
  })]);
  expect(cutoff.liabilities).toEqual(expect.objectContaining({ "old-loan": 0, "new-loan": 80_000 }));

  const sellHomes = calculateRetirementSnapshot({
    cutoff,
    snapshot: value.snapshot,
    scenario: value.scenario,
    withdrawalRateBps: 300,
  }).sellHomes;

  expect(sellHomes.available).toBe(true);
  if (!sellHomes.available) throw new Error("Expected sell-homes result");
  expect(sellHomes.grossHomeEquityCents).toBe(120_000);
  expect(sellHomes.incrementalSaleTaxCents).toBe(33);
  expect(sellHomes.netHomeProceedsCents).toBe(119_967);
  expect(JSON.stringify(value.scenario)).toBe(before);
});

describe("calculateRetirementSnapshot balance sheet and keep-homes scenario", () => {
  it("reconciles cutoff accounts, vested assets, the home, mortgage, and card exactly once", () => {
    const result = calculate(fixture());

    const accountTotal = 10_000 + 40_000;
    const vestedAssetTotal = 12_000 + 8_000;
    const homeValue = 200_000;
    const mortgage = 80_000;
    const cardDebt = 5_000;
    const expectedNetWorth = accountTotal + vestedAssetTotal + homeValue - mortgage - cardDebt;
    const expectedNonHomeNetWorth = expectedNetWorth - (homeValue - mortgage);
    const expectedWithdrawal = Math.round(Math.max(0, expectedNonHomeNetWorth) * 300 / 10_000);
    const expectedGrossRent = (1_200 + 300) * 12;

    expect(result.retirementMonth).toBe("2026-07");
    expect(result.withdrawalRateBps).toBe(300);
    expect(result.netWorthCents).toBe(expectedNetWorth);
    expect(result.keepHomes).toEqual({
      homeEquityCents: homeValue - mortgage,
      nonHomeNetWorthCents: expectedNonHomeNetWorth,
      withdrawalIncomeCents: expectedWithdrawal,
      grossRentalIncomeCents: expectedGrossRent,
      annualPreTaxIncomeCents: expectedWithdrawal + expectedGrossRent,
    });
  });

  it("keeps an ordinary purchased asset in net worth without requiring a property row", () => {
    const value = fixture();
    value.snapshot.assets = value.snapshot.assets.map((asset) => asset.id === "car"
      ? { ...asset, purchaseDate: "2024-01-01", purchasePriceCents: 12_000 }
      : asset);

    const result = calculate(value);

    expect(result.netWorthCents).toBe(185_000);
    expect(result.keepHomes.homeEquityCents).toBe(120_000);
    expect(result.sellHomes.available).toBe(true);
  });

  it("sums multiple homes while leaving non-mortgage debt in the withdrawal base", () => {
    const value = fixture();
    value.snapshot.assets = [...value.snapshot.assets, {
      id: "cabin",
      name: "Cabin",
      valueCents: 100_000,
      annualGrowthBps: 0,
      purchaseDate: "2021-01-01",
      purchasePriceCents: 100_000,
      homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0 }),
    }];
    value.cutoff = {
      ...value.cutoff,
      assets: { ...value.cutoff.assets, cabin: 100_000 },
      properties: [...value.cutoff.properties, {
        assetId: "cabin",
        name: "Cabin",
        valueCents: 100_000,
        mortgageCents: 0,
        monthlyGrossRentCents: 250,
        projectedDepreciationCents: 0,
        source: "current",
      }],
    };

    const result = calculate(value);

    expect(result.netWorthCents).toBe(285_000);
    expect(result.keepHomes).toEqual({
      homeEquityCents: 220_000,
      nonHomeNetWorthCents: 65_000,
      withdrawalIncomeCents: 1_950,
      grossRentalIncomeCents: 21_000,
      annualPreTaxIncomeCents: 22_950,
    });
  });

  it("floors withdrawal income at zero when non-home net worth is negative", () => {
    const value = fixture();
    value.cutoff = { ...value.cutoff, liabilities: { ...value.cutoff.liabilities, card: 105_000 } };

    expect(calculate(value).keepHomes).toEqual({
      homeEquityCents: 120_000,
      nonHomeNetWorthCents: -35_000,
      withdrawalIncomeCents: 0,
      grossRentalIncomeCents: 18_000,
      annualPreTaxIncomeCents: 18_000,
    });
  });

  it("does not restore future or unvested RSUs that are absent from cutoff assets", () => {
    const value = fixture();
    value.snapshot.assets = [...value.snapshot.assets, {
      id: "future-rsu",
      name: "Future RSUs",
      valueCents: 900_000,
      annualGrowthBps: 0,
      privateStock: { vestedBps: 0, vestingStartDate: "2027-01-01", remainingVestingQuarters: 4 },
    }];

    expect(calculate(value).netWorthCents).toBe(185_000);
  });
});

describe("calculateRetirementSnapshot sell-homes scenario", () => {
  it("replaces home equity with after-cost, after-mortgage, after-tax proceeds and sells only homes", () => {
    const result = calculate(fixture());

    expect(result.sellHomes).toEqual({
      available: true,
      grossHomeEquityCents: 120_000,
      sellingCostsCents: 10_000,
      incrementalSaleTaxCents: 0,
      netHomeProceedsCents: 110_000,
      liquidNetWorthCents: 175_000,
      annualPreTaxIncomeCents: 5_250,
    });
  });

  it("accepts a mortgage-free home only when no liability links to it", () => {
    const value = fixture();
    value.snapshot.liabilities = value.snapshot.liabilities.filter((liability) => liability.id !== "mortgage");
    value.cutoff = {
      ...value.cutoff,
      liabilities: { card: 5_000 },
      properties: [{ ...value.cutoff.properties[0], liabilityId: undefined, mortgageCents: 0 }],
    };

    expect(calculate(value).sellHomes).toEqual({
      available: true,
      grossHomeEquityCents: 200_000,
      sellingCostsCents: 10_000,
      incrementalSaleTaxCents: 0,
      netHomeProceedsCents: 190_000,
      liquidNetWorthCents: 255_000,
      annualPreTaxIncomeCents: 7_650,
    });
  });

  it("taxes all homes together under one household exclusion cap", () => {
    const value = fixture();
    value.snapshot.taxProfile = { ...value.snapshot.taxProfile, filingStatus: "married-joint" };
    value.snapshot.assets = ["first", "second"].map((id) => ({
      id,
      name: id === "first" ? "First home" : "Second home",
      valueCents: 400_000_00,
      annualGrowthBps: 0,
      purchaseDate: "2020-01-01",
      purchasePriceCents: 100_000_00,
      homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0, primaryResidenceExclusionEligible: true }),
    }));
    value.cutoff = {
      ...value.cutoff,
      accounts: {},
      assets: { first: 400_000_00, second: 400_000_00 },
      liabilities: {},
      properties: ["first", "second"].map((assetId) => ({
        assetId,
        name: assetId === "first" ? "First home" : "Second home",
        valueCents: 400_000_00,
        mortgageCents: 0,
        monthlyGrossRentCents: 0,
        projectedDepreciationCents: 0,
        source: "current" as const,
      })),
    };

    const sellHomes = calculate(value).sellHomes;

    expect(sellHomes.available).toBe(true);
    if (!sellHomes.available) throw new Error("Expected sell-homes result");
    expect(sellHomes.incrementalSaleTaxCents).toBe(316_153);
    expect(sellHomes.netHomeProceedsCents).toBe(79_683_847);
  });

  it("classifies a non-rental current home as personal independently of exclusion eligibility", () => {
    const value = fixture();
    value.cutoff = {
      ...value.cutoff,
      accounts: {},
      assets: { "personal-loss": 70_000_00, "rental-gain": 120_000_00 },
      liabilities: {},
      properties: [
        { assetId: "personal-loss", name: "Personal loss", valueCents: 70_000_00, mortgageCents: 0, monthlyGrossRentCents: 0, rentalUseBps: 0, projectedDepreciationCents: 0, source: "current" },
        { assetId: "rental-gain", name: "Rental gain", valueCents: 120_000_00, mortgageCents: 0, monthlyGrossRentCents: 1, projectedDepreciationCents: 0, source: "current" },
      ],
      taxLedger: completeTaxLedger({
        federalTaxableCents: 100_000_00,
        californiaTaxableCents: 100_000_00,
        modifiedAgiCents: 100_000_00,
      }),
    };
    value.snapshot.assets = [
      { id: "personal-loss", name: "Personal loss", valueCents: 70_000_00, annualGrowthBps: 0, purchaseDate: "2020-01-01", purchasePriceCents: 100_000_00, homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0 }) },
      { id: "rental-gain", name: "Rental gain", valueCents: 120_000_00, annualGrowthBps: 0, purchaseDate: "2020-01-01", purchasePriceCents: 100_000_00, rentalTaxBasisCents: 100_000_00, homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0 }) },
    ];
    value.snapshot.liabilities = [];

    const sellHomes = calculate(value).sellHomes;

    expect(sellHomes.available).toBe(true);
    if (!sellHomes.available) throw new Error("Expected sell-homes result");
    expect(sellHomes.incrementalSaleTaxCents).toBe(4_860_00);
  });

  it("uses planned rental details rather than exclusion eligibility to classify a planned home", () => {
    const value = fixture();
    value.cutoff = {
      ...value.cutoff,
      accounts: {},
      assets: { "planned-loss": 70_000_00, "rental-gain": 120_000_00 },
      liabilities: {},
      properties: [
        { assetId: "planned-loss", name: "Planned loss", valueCents: 70_000_00, mortgageCents: 0, monthlyGrossRentCents: 0, projectedDepreciationCents: 0, source: "planned" },
        { assetId: "rental-gain", name: "Rental gain", valueCents: 120_000_00, mortgageCents: 0, monthlyGrossRentCents: 1, projectedDepreciationCents: 0, source: "current" },
      ],
      taxLedger: completeTaxLedger({
        federalTaxableCents: 100_000_00,
        californiaTaxableCents: 100_000_00,
        modifiedAgiCents: 100_000_00,
      }),
    };
    value.snapshot.assets = [
      { id: "rental-gain", name: "Rental gain", valueCents: 120_000_00, annualGrowthBps: 0, purchaseDate: "2020-01-01", purchasePriceCents: 100_000_00, rentalTaxBasisCents: 100_000_00, homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0 }) },
    ];
    value.snapshot.liabilities = [];
    value.scenario.events = [{
      id: "buy-planned-loss",
      date: "2020-01-01",
      type: "asset-purchase",
      assetId: "planned-loss",
      name: "Planned loss",
      valueCents: 100_000_00,
      annualGrowthBps: 0,
      fundingAccountId: "cash",
      downPaymentCents: 100_000_00,
      costsCents: 0,
      propertyDetails: {
        primaryResidence: false,
        rentalUseBps: 10_000,
        homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0, primaryResidenceExclusionEligible: true }),
      },
    }];

    const sellHomes = calculate(value).sellHomes;

    expect(sellHomes.available).toBe(true);
    if (!sellHomes.available) throw new Error("Expected sell-homes result");
    expect(sellHomes.incrementalSaleTaxCents).toBe(0);
  });

  it("keeps a non-primary planned home personal when rental use and evidence are zero", () => {
    const value = fixture();
    value.snapshot.assets = value.snapshot.assets.filter((asset) => asset.id !== "home");
    value.snapshot.liabilities = value.snapshot.liabilities.filter((liability) => liability.id !== "mortgage");
    value.scenario.events = [{
      id: "buy-second-home",
      date: "2020-01-01",
      type: "asset-purchase",
      assetId: "home",
      name: "Home",
      valueCents: 190_000,
      annualGrowthBps: 0,
      fundingAccountId: "cash",
      downPaymentCents: 190_000,
      costsCents: 0,
      propertyDetails: {
        primaryResidence: false,
        rentalUseBps: 0,
        homeSaleAssumptions: saleAssumptions(),
      },
    }];
    value.cutoff = {
      ...value.cutoff,
      liabilities: { card: 5_000 },
      properties: [{
        ...value.cutoff.properties[0],
        source: "planned",
        liabilityId: undefined,
        mortgageCents: 0,
        monthlyGrossRentCents: 0,
        monthlyAduRentCents: 0,
        rentalUseBps: 0,
      }],
    };

    expect(calculate(value).sellHomes).toEqual(expect.objectContaining({ available: true }));
  });

  it.each(["current-land-basis", "planned-depreciation"] as const)(
    "recognizes %s as rental-use evidence",
    (evidence) => {
      const source = evidence === "current-land-basis" ? "current" as const : "planned" as const;
      const value = fixture();
      value.cutoff = {
        ...value.cutoff,
        accounts: {},
        assets: { loss: 70_000_00, gain: 120_000_00 },
        liabilities: {},
        properties: [
          { assetId: "loss", name: "Loss home", valueCents: 70_000_00, mortgageCents: 0, monthlyGrossRentCents: 0, projectedDepreciationCents: 0, source },
          { assetId: "gain", name: "Gain home", valueCents: 120_000_00, mortgageCents: 0, monthlyGrossRentCents: 1, projectedDepreciationCents: 0, source: "current" },
        ],
        taxLedger: completeTaxLedger({
          federalTaxableCents: 100_000_00,
          californiaTaxableCents: 100_000_00,
          modifiedAgiCents: 100_000_00,
        }),
      };
      value.snapshot.assets = [
        ...(source === "current" ? [{
          id: "loss",
          name: "Loss home",
          valueCents: 70_000_00,
          annualGrowthBps: 0,
          purchaseDate: "2020-01-01",
          purchasePriceCents: 100_000_00,
          rentalLandBasisCents: 20_000_00,
          homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0 }),
        }] : []),
        {
          id: "gain",
          name: "Gain home",
          valueCents: 120_000_00,
          annualGrowthBps: 0,
          purchaseDate: "2020-01-01",
          purchasePriceCents: 100_000_00,
          rentalTaxBasisCents: 100_000_00,
          homeSaleAssumptions: saleAssumptions({ sellingCostBps: 0 }),
        },
      ];
      value.snapshot.liabilities = [];
      value.scenario.events = source === "planned" ? [{
        id: "buy-loss",
        date: "2020-01-01",
        type: "asset-purchase",
        assetId: "loss",
        name: "Loss home",
        valueCents: 100_000_00,
        annualGrowthBps: 0,
        fundingAccountId: "cash",
        downPaymentCents: 100_000_00,
        costsCents: 0,
        propertyDetails: {
          homeSaleAssumptions: saleAssumptions({
            sellingCostBps: 0,
            accumulatedFederalDepreciationCents: 1,
            accumulatedCaliforniaDepreciationCents: 1,
          }),
        },
      }] : [];

      const sellHomes = calculate(value).sellHomes;

      expect(sellHomes.available).toBe(true);
      if (!sellHomes.available) throw new Error("Expected sell-homes result");
      expect(sellHomes.incrementalSaleTaxCents).toBe(0);
    },
  );

  describe.each(["current", "planned"] as const)("%s home metadata", (source) => {
    it("adds projected depreciation to both stored federal and California amounts", () => {
      const value = fixture();
      value.cutoff = {
        ...value.cutoff,
        retirementMonth: "2026-01",
        balanceMonth: "2025-12",
        accounts: {},
        assets: { home: 110_000_00 },
        liabilities: {},
        properties: [{
          assetId: "home",
          name: "Home",
          valueCents: 110_000_00,
          mortgageCents: 0,
          monthlyGrossRentCents: 0,
          projectedDepreciationCents: 6_000_00,
          source,
        }],
        taxLedger: completeTaxLedger({
          federalTaxableCents: 40_000_00,
          californiaTaxableCents: 0,
          modifiedAgiCents: 40_000_00,
        }),
      };
      const assumptions = saleAssumptions({
        sellingCostBps: 0,
        accumulatedFederalDepreciationCents: 4_000_00,
        accumulatedCaliforniaDepreciationCents: 4_000_00,
      });
      value.snapshot.assets = source === "current" ? [{
        id: "home",
        name: "Home",
        valueCents: 110_000_00,
        annualGrowthBps: 0,
        purchaseDate: "2020-01-01",
        purchasePriceCents: 100_000_00,
        homeSaleAssumptions: assumptions,
      }] : [];
      value.snapshot.liabilities = [];
      value.scenario.events = source === "planned" ? [{
        id: "buy-home",
        date: "2020-01-01",
        type: "asset-purchase",
        assetId: "home",
        name: "Home",
        valueCents: 100_000_00,
        annualGrowthBps: 0,
        fundingAccountId: "cash",
        downPaymentCents: 100_000_00,
        costsCents: 0,
        propertyDetails: { rentalUseBps: 10_000, homeSaleAssumptions: assumptions },
      }] : [];

      const sellHomes = calculate(value).sellHomes;

      expect(sellHomes.available).toBe(true);
      if (!sellHomes.available) throw new Error("Expected sell-homes result");
      expect(sellHomes.incrementalSaleTaxCents).toBe(2_986_44);
      expect(sellHomes.liquidNetWorthCents).toBe(10_701_356);
    });
  });

  describe.each(["current-partial", "planned-partial", "adu-partial"] as const)(
    "mixed use from %s evidence",
    (evidence) => {
      it("returns a structured limitation before tax calculation", () => {
        const value = fixture();
        const property = value.cutoff.properties[0];
        value.cutoff = {
          ...value.cutoff,
          properties: [{
            ...property,
            source: evidence === "planned-partial" ? "planned" : "current",
            rentalUseBps: evidence === "adu-partial" ? undefined : 2_500,
            monthlyAduRentCents: evidence === "adu-partial" ? 300 : 0,
          }],
          taxLedger: completeTaxLedger({ federalTaxableCents: -1 }),
        };
        if (evidence === "planned-partial") {
          value.snapshot.assets = value.snapshot.assets.filter((asset) => asset.id !== "home");
          value.snapshot.liabilities = value.snapshot.liabilities.filter((liability) => liability.id !== "mortgage");
          value.scenario.events = [{
            id: "buy-home",
            date: "2020-01-01",
            type: "asset-purchase",
            assetId: "home",
            name: "Home",
            valueCents: 190_000,
            annualGrowthBps: 0,
            fundingAccountId: "cash",
            downPaymentCents: 110_000,
            costsCents: 0,
            financing: { liabilityId: "mortgage", name: "Mortgage", principalCents: 80_000, annualRateBps: 0, minimumPaymentCents: 0 },
            propertyDetails: {
              primaryResidence: true,
              rentalUseBps: 2_500,
              homeSaleAssumptions: saleAssumptions(),
            },
          }];
        }

        expect(calculate(value).sellHomes).toEqual({
          available: false,
          issues: [{
            assetId: "home",
            assetName: "Home",
            field: "rentalUse",
            message: "Review rental use for Home; mixed-use sale tax is not supported.",
          }],
        });
      });
    },
  );
});

const issueMessages: Record<RetirementMissingData["field"], string> = {
  purchaseDate: "Add a purchase date for Home.",
  taxBasis: "Add a tax basis for Home.",
  sellingCostBps: "Add selling costs for Home.",
  mortgageBalance: "Add the mortgage balance for Home.",
  primaryResidenceEligibility: "Confirm primary residence eligibility for Home.",
  federalDepreciation: "Add federal depreciation for Home.",
  californiaDepreciation: "Add California depreciation for Home.",
  rentalUse: "Review rental use for Home; mixed-use sale tax is not supported.",
};

const missingCases: readonly {
  field: RetirementMissingData["field"];
  mutate: (value: Fixture) => void;
}[] = [
  { field: "purchaseDate", mutate: (value) => { currentHome(value).purchaseDate = null; } },
  { field: "taxBasis", mutate: (value) => { currentHome(value).purchasePriceCents = null; } },
  {
    field: "sellingCostBps",
    mutate: (value) => {
      currentHome(value).homeSaleAssumptions = {
        ...currentHome(value).homeSaleAssumptions,
        sellingCostBps: undefined,
      } as unknown as HomeSaleAssumptions;
    },
  },
  {
    field: "mortgageBalance",
    mutate: (value) => { value.cutoff = { ...value.cutoff, liabilities: { card: 5_000 } }; },
  },
  {
    field: "primaryResidenceEligibility",
    mutate: (value) => {
      currentHome(value).homeSaleAssumptions = {
        ...currentHome(value).homeSaleAssumptions,
        primaryResidenceExclusionEligible: undefined,
      } as unknown as HomeSaleAssumptions;
    },
  },
  {
    field: "federalDepreciation",
    mutate: (value) => {
      currentHome(value).homeSaleAssumptions = {
        ...currentHome(value).homeSaleAssumptions,
        accumulatedFederalDepreciationCents: undefined,
      } as unknown as HomeSaleAssumptions;
    },
  },
  {
    field: "californiaDepreciation",
    mutate: (value) => {
      currentHome(value).homeSaleAssumptions = {
        ...currentHome(value).homeSaleAssumptions,
        accumulatedCaliforniaDepreciationCents: undefined,
      } as unknown as HomeSaleAssumptions;
    },
  },
];

describe("calculateRetirementSnapshot unavailable sell-homes result", () => {
  it.each(missingCases)("returns a structured $field issue", ({ field, mutate }) => {
    const value = fixture();
    mutate(value);

    expect(calculate(value).sellHomes).toEqual({
      available: false,
      issues: [{ assetId: "home", assetName: "Home", field, message: issueMessages[field] }],
    });
  });

  it("collects every issue before invoking tax calculation", () => {
    const value = fixture();
    currentHome(value).purchaseDate = null;
    currentHome(value).purchasePriceCents = null;
    currentHome(value).homeSaleAssumptions = null;
    value.cutoff = {
      ...value.cutoff,
      liabilities: { card: 5_000 },
      taxLedger: completeTaxLedger({ federalTaxableCents: -1 }),
    };

    expect(calculate(value).sellHomes).toEqual({
      available: false,
      issues: missingCases.map(({ field }) => ({
        assetId: "home",
        assetName: "Home",
        field,
        message: issueMessages[field],
      })),
    });
  });

  it("treats a property mortgage that disagrees with the liability map as unavailable", () => {
    const value = fixture();
    value.cutoff = {
      ...value.cutoff,
      properties: [{ ...value.cutoff.properties[0], mortgageCents: 79_999 }],
    };

    expect(calculate(value).sellHomes).toEqual({
      available: false,
      issues: [{
        assetId: "home",
        assetName: "Home",
        field: "mortgageBalance",
        message: "Add the mortgage balance for Home.",
      }],
    });
  });
});

describe("calculateRetirementSnapshot validation", () => {
  it.each([-1, 0, 10_001, 300.5])("rejects an invalid withdrawal rate of %s basis points", (withdrawalRateBps) => {
    expect(() => calculate(fixture(), withdrawalRateBps)).toThrow(
      "withdrawalRateBps must be an integer from 1 to 10000",
    );
  });

  it("accepts a one-basis-point withdrawal rate", () => {
    const result = calculate(fixture(), 1);

    expect(result.withdrawalRateBps).toBe(1);
    expect(result.keepHomes.withdrawalIncomeCents).toBe(7);
    expect(result.sellHomes).toEqual(expect.objectContaining({
      available: true,
      annualPreTaxIncomeCents: 18,
    }));
  });

  it("rejects duplicate property rows", () => {
    const value = fixture();
    value.cutoff = {
      ...value.cutoff,
      properties: [...value.cutoff.properties, { ...value.cutoff.properties[0] }],
    };

    expect(() => calculate(value)).toThrow(
      "Retirement cutoff properties must contain one row for asset home",
    );
  });

  it("rejects a property row whose asset is missing from cutoff assets", () => {
    const value = fixture();
    const { home: _home, ...assets } = value.cutoff.assets;
    value.cutoff = { ...value.cutoff, assets };

    expect(() => calculate(value)).toThrow(
      "Retirement cutoff property home is missing from cutoff assets",
    );
  });

  it("rejects an owned home asset whose property row is missing", () => {
    const value = fixture();
    value.cutoff = { ...value.cutoff, properties: [] };

    expect(() => calculate(value)).toThrow(
      "Retirement cutoff is missing a property row for home",
    );
  });

  it("rejects a property value that disagrees with cutoff assets", () => {
    const value = fixture();
    value.cutoff = {
      ...value.cutoff,
      properties: [{ ...value.cutoff.properties[0], valueCents: 199_999 }],
    };

    expect(() => calculate(value)).toThrow(
      "Retirement cutoff property home value must match cutoff assets",
    );
  });
});
