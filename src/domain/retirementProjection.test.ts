import { describe, expect, test } from "vitest";
import { calculateRetirementProjection } from "./retirementProjection";
import type { FinancialSnapshot, Scenario } from "./types";
import type { NormalizedRetirementSettings } from "./retirementSettings";

const financialSnapshot: FinancialSnapshot = {
  household: {
    id: "household-1",
    name: "Morgan household",
    state: "CA",
    people: [{ id: "person-1", name: "Morgan", birthDate: "1980-06-15" }],
  },
  taxProfile: {
    filingStatus: "single",
    state: "CA",
    taxYear: 2026,
    thresholdInflationBps: 250,
    taxUnit: {
      id: "tax-unit-1",
      filingStatus: "single",
      memberPersonIds: ["person-1"],
    },
  },
  accounts: [{
    id: "taxable-1",
    name: "Taxable brokerage",
    kind: "investment",
    subtype: "taxable-brokerage",
    balanceCents: 1_000_000_00,
    taxableCostBasisCents: 1_000_000_00,
    annualReturnBps: 0,
    liquid: true,
  }],
  recurring: [],
  assets: [],
  liabilities: [],
};

const scenario: Scenario = {
  id: "scenario-1",
  name: "Short display plan",
  assumptions: { inflationBps: 250, thresholdInflationBps: 250 },
  assumptionsInherited: false,
  events: [],
  defaultContributionAccountId: "taxable-1",
  contributions: [],
  withdrawals: [],
  horizon: { start: "2026-01", months: 12 },
};

const settings: NormalizedRetirementSettings = {
  retirementMonth: "2042-01",
  withdrawalRateBps: 300,
  horizonYears: 30,
  taxableDestinationAccountId: "taxable-1",
  withdrawalAccountOrder: [],
  selectedScenario: "keep-homes",
  revision: 1,
};

describe("calculateRetirementProjection", () => {
  // Production mutation caught: dropping either snapshot-derived scenario summary leaves the overview without its shared source of truth.
  test("returns both retirement scenario summaries with annual rows", () => {
    const result = calculateRetirementProjection({
      snapshot: financialSnapshot,
      scenario,
      asOfDate: "2026-01-15",
      settings,
    });

    expect(result.keepHomes.summary).toEqual({
      homeEquityCents: 0,
      nonHomeNetWorthCents: 1_000_000_00,
      withdrawalIncomeCents: 3_000_000,
      grossRentalIncomeCents: 0,
      annualPreTaxIncomeCents: 3_000_000,
    });
    expect(result.sellHomes.available).toBe(true);
    if (!result.sellHomes.available) throw new Error("expected Sell homes to be available");
    expect(result.sellHomes.summary).toEqual({
      available: true,
      grossHomeEquityCents: 0,
      sellingCostsCents: 0,
      incrementalSaleTaxCents: 0,
      netHomeProceedsCents: 0,
      liquidNetWorthCents: 1_000_000_00,
      annualPreTaxIncomeCents: 3_000_000,
    });
    expect(result.keepHomes.years).toHaveLength(30);
    expect(result.sellHomes.years).toHaveLength(30);
  });

  // Production mutation caught: using or mutating the Plan's 12-month display horizon truncates the independent 30-year retirement series.
  test("extends the horizon to complete retirement years without mutating the scenario", () => {
    const before = JSON.stringify(scenario);

    const result = calculateRetirementProjection({
      snapshot: financialSnapshot,
      scenario,
      asOfDate: "2026-01-15",
      settings,
    });

    expect(result.keepHomes.years[0].year).toBe(2042);
    expect(result.keepHomes.years.at(-1)?.year).toBe(2071);
    expect(JSON.stringify(scenario)).toBe(before);
  });

  // Production mutation caught: sizing from Scenario.horizon.start instead of the engine's as-of month truncates a valid retirement when the two starts differ.
  test("anchors the extended Plan horizon to the ProjectionEngine as-of month", () => {
    const result = calculateRetirementProjection({
      snapshot: financialSnapshot,
      scenario: { ...scenario, horizon: { start: "2027-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", horizonYears: 2 },
    });

    expect(result.keepHomes.years.map((year) => year.year)).toEqual([2027, 2028]);
    expect(result.keepHomes.years[1].warnings).not.toContainEqual(expect.objectContaining({
      code: "calculation-error",
    }));
  });

  // Production mutation caught: restoring either the 2100 tax-rule ceiling or the 1200-month engine cap makes a valid late 60-year retirement projection throw.
  test("supports a late retirement through every year of the maximum horizon", () => {
    const lateScenario: Scenario = {
      ...scenario,
      horizon: { start: "2026-12", months: 12 },
    };
    const before = JSON.stringify(lateScenario);

    const result = calculateRetirementProjection({
      snapshot: financialSnapshot,
      scenario: lateScenario,
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2099-01",
        withdrawalRateBps: 1,
        horizonYears: 60,
      },
    });

    expect(result.keepHomes.years).toHaveLength(60);
    expect(result.keepHomes.years[0].year).toBe(2099);
    expect(result.keepHomes.years.at(-1)?.year).toBe(2158);
    expect(result.sellHomes.available).toBe(true);
    if (!result.sellHomes.available) throw new Error("expected Sell homes to be available");
    expect(result.sellHomes.years).toHaveLength(60);
    expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: "calculation-error" }));
    expect(JSON.stringify(lateScenario)).toBe(before);
  });

  // Production mutation caught: taxing a July-to-June row once under 2027 rules omits cutoff wages and fails to use 2028 thresholds for the second six months.
  test("taxes a non-January retirement by calendar year on top of cutoff wages", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        recurring: [
          { id: "salary", name: "Salary", amountCents: 24_000_000, kind: "income", incomeType: "salary", incomeTaxCategory: "wages", ownerPersonId: "person-1", startDate: "2027-01-01", annualGrowthBps: 0, taxTreatment: "none" },
          { id: "pension", name: "Pension", amountCents: 1_000_000, kind: "income", incomeTaxCategory: "taxable-nonwage", startDate: "2027-07-01", frequency: "monthly", annualGrowthBps: 0, taxTreatment: "none" },
          { id: "pre-retirement-spending", name: "Pre-retirement spending", amountCents: 2_000_000, kind: "expense", startDate: "2027-01-01", endDate: "2027-06-30", frequency: "monthly", annualGrowthBps: 0, taxTreatment: "none" },
        ],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-07", withdrawalRateBps: 1, horizonYears: 1 },
    });
    const year = result.keepHomes.years[0];

    expect(year.otherPreTaxIncomeCents).toBe(12_000_000);
    expect(year.estimatedTaxCents).toBe(2_644_815);
    expect(year.afterTaxIncomeCents).toBe(9_365_185);
  });

  // Production mutation caught: calculating sale tax before retirement income understates LTCG brackets, California tax, and NIIT instead of composing one household stack.
  test("composes Sell home gain with retirement income in the same tax calculation", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{ ...financialSnapshot.accounts[0], balanceCents: 100_000_000, taxableCostBasisCents: 100_000_000 }],
        recurring: [{ id: "pension", name: "Pension", amountCents: 5_000_000, kind: "income", incomeTaxCategory: "taxable-nonwage", startDate: "2027-01-01", frequency: "monthly", annualGrowthBps: 0, taxTreatment: "none" }],
        assets: [{
          id: "rental-home",
          name: "Rental home",
          valueCents: 20_000_000,
          annualGrowthBps: 0,
          purchasePriceCents: 10_000_000,
          purchaseDate: "2020-01-01",
          rentalTaxBasisCents: 10_000_000,
          homeSaleAssumptions: { sellingCostBps: 0, primaryResidenceExclusionEligible: false, accumulatedFederalDepreciationCents: 0, accumulatedCaliforniaDepreciationCents: 0 },
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });
    expect(result.sellHomes.available).toBe(true);
    if (!result.sellHomes.available) throw new Error("expected Sell homes to be available");
    const year = result.sellHomes.years[0];

    expect(year.otherPreTaxIncomeCents).toBe(60_000_000);
    expect(year.startingPortfolioCents).toBe(116_490_000);
    expect(year.withdrawalTargetCents).toBe(11_649);
    expect(year.estimatedTaxCents).toBe(22_020_228);
    expect(year.homeSale?.incrementalSaleTaxCents).toBe(3_510_000);
    expect(year.homeSale?.netProceedsCents).toBe(16_490_000);
    expect(year.estimatedTaxCents + year.homeSale!.incrementalSaleTaxCents).toBe(25_530_228);
    expect(result.sellHomes.summary).toMatchObject({
      incrementalSaleTaxCents:3_510_000,
      netHomeProceedsCents:16_490_000,
      liquidNetWorthCents:116_490_000,
      annualPreTaxIncomeCents:11_649,
    });
  });

  // Production mutation caught: reusing year one's target or failing to add surplus deposits to taxable basis makes year two's target or realized gain wrong.
  test("recalculates the annual target and deposits surplus with matching taxable basis", () => {
    const snapshotWithCashFlow: FinancialSnapshot = {
      ...financialSnapshot,
      recurring: [
        {
          id: "pension-1",
          name: "Pension",
          amountCents: 200_000,
          kind: "income",
          incomeTaxCategory: "nontaxable",
          startDate: "2027-01-01",
          frequency: "monthly",
          annualGrowthBps: 0,
          taxTreatment: "none",
        },
        {
          id: "expense-1",
          name: "Living expenses",
          amountCents: 100_000,
          kind: "expense",
          startDate: "2027-01-01",
          frequency: "monthly",
          annualGrowthBps: 0,
          taxTreatment: "none",
        },
      ],
    };
    const result = calculateRetirementProjection({
      snapshot: snapshotWithCashFlow,
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        withdrawalRateBps: 100,
        horizonYears: 2,
      },
    });
    const [first, second] = result.keepHomes.years;

    expect(first.startingPortfolioCents).toBe(100_000_000);
    expect(first.withdrawalTargetCents).toBe(1_000_000);
    expect(first.otherPreTaxIncomeCents).toBe(2_400_000);
    expect(first.planExpenseCents).toBe(1_200_000);
    expect(first.surplusCents).toBe(2_200_000);
    expect(first.destinationBalanceCents).toBe(101_200_000);
    expect(second.startingPortfolioCents).toBe(101_200_000);
    expect(second.withdrawalTargetCents).toBe(1_012_000);
    expect(second.surplusCents).toBe(2_212_000);
    expect(second.destinationBalanceCents).toBe(102_400_000);
    expect(second.withdrawalSources[0].taxableGainCents).toBe(0);
  });

  // Production mutation caught: copying only Plan assets and liabilities drops contribution, transfer, origination, and payoff account deltas and creates $30,000 of phantom loss.
  test("applies post-retirement account event transitions exactly once with taxable basis", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [
          { ...financialSnapshot.accounts[0], balanceCents: 10_000_000, taxableCostBasisCents: 10_000_000 },
          { id: "cash-1", name: "Cash", kind: "checking", subtype: "cash", balanceCents: 5_000_000, annualReturnBps: 0, liquid: true },
        ],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [
          { id: "contribution", date: "2027-03-01", type: "account-contribution", accountId: "taxable-1", amountCents: 1_000_000 },
          { id: "transfer", date: "2027-04-01", type: "account-transfer", fromAccountId: "cash-1", toAccountId: "taxable-1", amountCents: 2_000_000 },
          { id: "origination", date: "2027-05-01", type: "debt-origination", liabilityId: "loan-1", name: "Loan", principalCents: 3_000_000, annualRateBps: 0, minimumPaymentCents: 0, accountId: "cash-1" },
          { id: "payoff", date: "2027-06-01", type: "debt-payoff", liabilityId: "loan-1", accountId: "cash-1", amountCents: 1_000_000 },
        ],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });
    const year = result.keepHomes.years[0];

    expect(year.startingPortfolioCents).toBe(15_000_000);
    expect(year.withdrawalTargetCents).toBe(1_500);
    expect(year.withdrawalSources[0].taxableGainCents).toBe(0);
    expect(year.endingBalances).toEqual({
      accounts: { "taxable-1": 13_000_000, "cash-1": 5_000_000 },
      assets: {},
      liabilities: { "loan-1": 2_000_000 },
    });
    expect(year.endingNetWorthCents).toBe(16_000_000);
  });

  // Production mutation caught: treating Sell as a permanent all-home filter suppresses a later planned home, its funding, and its seven months of carrying cost.
  test("keeps a home acquired after retirement in both scenarios", () => {
    const plannedHomeScenario: Scenario = {
      ...scenario,
      horizon: { start: "2026-12", months: 12 },
      events: [{
        id: "future-home",
        date: "2027-06-01",
        type: "asset-purchase",
        assetId: "future-home",
        name: "Future home",
        valueCents: 12_000_000,
        annualGrowthBps: 0,
        fundingAccountId: "taxable-1",
        downPaymentCents: 12_000_000,
        costsCents: 0,
        housingCosts: {
          propertyTaxRateBps: 1_200,
          insuranceMonthlyCents: 0,
          insuranceAnnualGrowthBps: 0,
          hoaMonthlyCents: 0,
          hoaAnnualGrowthBps: 0,
        },
        propertyDetails: { primaryResidence: true },
      }],
    };
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{ ...financialSnapshot.accounts[0], balanceCents: 20_000_000, taxableCostBasisCents: 20_000_000 }],
      },
      scenario: plannedHomeScenario,
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 2 },
    });
    expect(result.sellHomes.available).toBe(true);
    if (!result.sellHomes.available) throw new Error("expected Sell homes to be available");

    for (const years of [result.keepHomes.years, result.sellHomes.years]) {
      expect(years[0].housingExpenseCents).toBe(844_174);
      expect(years[0].endingBalances.assets).toEqual({ "future-home": 12_000_000 });
      expect(years[0].endingBalances.accounts["taxable-1"]).toBe(7_155_826);
      expect(years[1].startingPortfolioCents).toBe(7_155_826);
    }
  });

  // Production mutation caught: leaving a later-sold home in the dynamic home set cancels its surviving liability out of next year's investable portfolio.
  test("processes a kept home's later sale once and removes it from home equity", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{ ...financialSnapshot.accounts[0], balanceCents: 10_000_000, taxableCostBasisCents: 10_000_000 }],
        assets: [{
          id: "home",
          name: "Home",
          valueCents: 50_000_000,
          annualGrowthBps: 0,
          purchasePriceCents: 50_000_000,
          purchaseDate: "2020-01-01",
          homeSaleAssumptions: { sellingCostBps: 0, primaryResidenceExclusionEligible: true, accumulatedFederalDepreciationCents: 0, accumulatedCaliforniaDepreciationCents: 0 },
        }],
        liabilities: [{
          id: "mortgage",
          name: "Mortgage",
          balanceCents: 20_000_000,
          annualRateBps: 0,
          minimumPaymentCents: 0,
          mortgage: { originalPrincipalCents: 20_000_000, termMonths: 360, startDate: "2020-01-01", assetId: "home" },
        }],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [{ id: "later-sale", date: "2027-06-01", type: "asset-sale", assetId: "home", proceedsCents: 50_000_000, costsCents: 0, destinationAccountId: "taxable-1" }],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 2 },
    });

    expect(result.keepHomes.years[0].endingBalances).toEqual({
      accounts: { "taxable-1": 60_000_000 },
      assets: {},
      liabilities: { mortgage: 20_000_000 },
    });
    expect(result.keepHomes.years[1].startingPortfolioCents).toBe(40_000_000);
  });

  // Production mutation caught: replaying a later Plan sale transition for a home already sold at retirement deposits the same gross proceeds twice in Sell.
  test("does not replay a later Plan sale for a retirement-sold home", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{ ...financialSnapshot.accounts[0], balanceCents: 10_000_000, taxableCostBasisCents: 10_000_000 }],
        assets: [{
          id: "home",
          name: "Home",
          valueCents: 50_000_000,
          annualGrowthBps: 0,
          purchasePriceCents: 50_000_000,
          purchaseDate: "2020-01-01",
          homeSaleAssumptions: { sellingCostBps: 0, primaryResidenceExclusionEligible: true, accumulatedFederalDepreciationCents: 0, accumulatedCaliforniaDepreciationCents: 0 },
        }],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [{ id: "later-sale", date: "2027-06-01", type: "asset-sale", assetId: "home", proceedsCents: 50_000_000, costsCents: 0, destinationAccountId: "taxable-1" }],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });
    expect(result.sellHomes.available).toBe(true);
    if (!result.sellHomes.available) throw new Error("expected Sell homes to be available");

    expect(result.sellHomes.years[0].endingBalances.accounts["taxable-1"]).toBe(60_000_000);
  });

  // Production mutation caught: applying no return or a simple annual addition instead of the Plan's monthly compounding changes the exact ending account value.
  test("applies configured account returns before the annual withdrawal", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{
          ...financialSnapshot.accounts[0],
          annualReturnBps: 10_000,
          taxLots: [{
            id: "old-lot",
            acquiredOn: "2020-01-01",
            marketValueCents: 100_000_000,
            federalBasisCents: 100_000_000,
            californiaBasisCents: 100_000_000,
          }],
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        withdrawalRateBps: 100,
        horizonYears: 1,
      },
    });
    const year = result.keepHomes.years[0];

    expect(year.startingPortfolioCents).toBe(105_946_309);
    expect(year.withdrawalTargetCents).toBe(1_059_463);
    expect(year.withdrawalSources[0].taxableGainCents).toBe(559_463);
    expect(year.endingBalances.accounts["taxable-1"]).toBe(211_892_616);
  });

  // Production mutation caught: omitting rent, a housing-cost component, or mortgage amortization breaks the literal annual cash flow and balance-sheet reconciliation.
  test("rolls forward kept-home rent, full housing costs, mortgage, and net worth", () => {
    const propertyScenario: Scenario = {
      ...scenario,
      horizon: { start: "2026-12", months: 12 },
      events: [{
        id: "purchase-1",
        date: "2026-12-01",
        type: "asset-purchase",
        assetId: "rental-1",
        name: "Rental home",
        valueCents: 12_000_000,
        annualGrowthBps: 0,
        housingCosts: {
          propertyTaxRateBps: 1_200,
          insuranceMonthlyCents: 10_000,
          insuranceAnnualGrowthBps: 0,
          hoaMonthlyCents: 5_000,
          hoaAnnualGrowthBps: 0,
        },
        fundingAccountId: "taxable-1",
        downPaymentCents: 2_000_000,
        costsCents: 0,
        propertyDetails: {
          primaryResidence: false,
          monthlyRentalIncomeCents: 100_000,
          rentalIncomeGrowthBps: 0,
          maintenanceBps: 100,
          rentalUseBps: 10_000,
          rentalTaxModelingEnabled: true,
          rentalType: "short-term",
          shortTermMaterialParticipation: true,
          buildingBasisCents: 12_000_000,
        },
        financing: {
          liabilityId: "mortgage-1",
          name: "Rental mortgage",
          principalCents: 10_000_000,
          annualRateBps: 1_200,
          minimumPaymentCents: 200_000,
          termMonths: 360,
        },
      }],
    };
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{
          ...financialSnapshot.accounts[0],
          balanceCents: 20_000_000,
          taxableCostBasisCents: 20_000_000,
        }],
        recurring: [{
          id: "expense-1",
          name: "Living expenses",
          amountCents: 50_000,
          kind: "expense",
          startDate: "2027-01-01",
          frequency: "monthly",
          annualGrowthBps: 0,
          taxTreatment: "none",
        }],
      },
      scenario: propertyScenario,
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        horizonYears: 1,
      },
    });
    const year = result.keepHomes.years[0];

    expect(year.startingPortfolioCents).toBe(18_000_000);
    expect(year.withdrawalTargetCents).toBe(540_000);
    expect(year.rentalIncomeCents).toBe(1_200_000);
    expect(year.planExpenseCents).toBe(600_000);
    expect(year.housing).toEqual({
      principalCents: 1_280_934,
      interestCents: 1_119_066,
      propertyTaxCents: 1_455_554,
      insuranceCents: 120_000,
      hoaCents: 60_000,
      maintenanceCents: 120_000,
    });
    expect(year.housingExpenseCents).toBe(4_155_554);
    expect(year.shortfallCents).toBe(3_015_554);
    expect(year.endingBalances.accounts["taxable-1"]).toBe(14_444_446);
    expect(year.endingBalances.assets["rental-1"]).toBe(12_000_000);
    expect(year.endingBalances.liabilities["mortgage-1"]).toBe(8_619_066);
    expect(year.endingNetWorthCents).toBe(17_825_380);
    expect(year.endingNetWorthCents).toBe(
      Object.values(year.endingBalances.accounts).reduce((sum, value) => sum + value, 0) +
      Object.values(year.endingBalances.assets).reduce((sum, value) => sum + value, 0) -
      Object.values(year.endingBalances.liabilities).reduce((sum, value) => sum + value, 0),
    );
  });

  // Production mutation caught: treating rent with disabled modeling as nontaxable silently understates tax instead of returning an actionable unsupported result.
  test("returns a structured error for rental income without supported tax modeling", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        assets: [{ id: "home-1", name: "Home", valueCents: 12_000_000, annualGrowthBps: 0, housingCosts: { propertyTaxRateBps: 0, insuranceMonthlyCents: 0, insuranceAnnualGrowthBps: 0, hoaMonthlyCents: 0, hoaAnnualGrowthBps: 0 } }],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [{ id: "rent", date: "2027-01-01", type: "property-rental-start", assetId: "home-1", name: "Home rent", monthlyRentalIncomeCents: 1_000_000, rentalIncomeGrowthBps: 0, rentalUseBps: 10_000, rentalTaxModelingEnabled: false, rentalType: "long-term" }],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });
    const year = result.keepHomes.years[0];

    expect(year.endingBalances).toEqual({ accounts: {}, assets: {}, liabilities: {} });
    expect(year.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported-rental-tax", year: 2027, entityId: "home-1" }),
      expect.objectContaining({ code: "calculation-error", year: 2027 }),
    ]));
  });

  // Production mutation caught: deducting all mixed-use housing both from rental income and as personal itemized expense double-counts the rental half.
  test("taxes mixed-use rent by jurisdiction while deducting only personal housing", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        assets: [{
          id: "home-1",
          name: "Mixed-use home",
          valueCents: 120_000_000,
          annualGrowthBps: 0,
          purchasePriceCents: 120_000_000,
          purchaseDate: "2027-01-01",
          housingCosts: { propertyTaxRateBps: 1_200, insuranceMonthlyCents: 0, insuranceAnnualGrowthBps: 0, hoaMonthlyCents: 0, hoaAnnualGrowthBps: 0 },
        }],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [{ id: "rent", date: "2027-01-01", type: "property-rental-start", assetId: "home-1", name: "Mixed-use rent", monthlyRentalIncomeCents: 2_000_000, rentalIncomeGrowthBps: 0, rentalUseBps: 5_000, rentalTaxModelingEnabled: true, rentalType: "long-term", buildingBasisCents: 0 }],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });
    const year = result.keepHomes.years[0];

    expect(year.rentalIncomeCents).toBe(24_000_000);
    expect(year.housing.propertyTaxCents).toBe(14_531_528);
    expect(year.estimatedTaxCents).toBe(2_784_712);
  });

  // Production mutation caught: deducting a raw passive rental loss as ordinary income bypasses household allowance and carryforward limits.
  test("returns a structured error when passive rental-loss limits cannot be resolved", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        assets: [{ id: "rental-1", name: "Loss rental", valueCents: 120_000_000, annualGrowthBps: 0, purchasePriceCents: 120_000_000, purchaseDate: "2027-01-01", housingCosts: { propertyTaxRateBps: 1_200, insuranceMonthlyCents: 0, insuranceAnnualGrowthBps: 0, hoaMonthlyCents: 0, hoaAnnualGrowthBps: 0 } }],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [{ id: "rent", date: "2027-01-01", type: "property-rental-start", assetId: "rental-1", name: "Loss rental", monthlyRentalIncomeCents: 500_000, rentalIncomeGrowthBps: 0, rentalUseBps: 10_000, rentalTaxModelingEnabled: true, rentalType: "long-term", buildingBasisCents: 0 }],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });
    const year=result.keepHomes.years[0];

    expect(year.endingBalances).toEqual({accounts:{},assets:{},liabilities:{}});
    expect(year.warnings).toContainEqual(expect.objectContaining({code:"unsupported-rental-tax",entityId:"rental-1"}));
  });

  // Production mutation caught: ignoring unequal federal and California passive carryforwards taxes positive rent under a fabricated shared jurisdictional baseline.
  test("returns a structured error for unresolved jurisdictional rental carryforwards", () => {
    const result=calculateRetirementProjection({
      snapshot:{
        ...financialSnapshot,
        assets:[{id:"rental-1",name:"Carryforward rental",valueCents:12_000_000,annualGrowthBps:0,federalPassiveLossCarryforwardCents:1_000_000,californiaPassiveLossCarryforwardCents:2_000_000,housingCosts:{propertyTaxRateBps:0,insuranceMonthlyCents:0,insuranceAnnualGrowthBps:0,hoaMonthlyCents:0,hoaAnnualGrowthBps:0}}],
      },
      scenario:{...scenario,horizon:{start:"2026-12",months:12},events:[{id:"rent",date:"2027-01-01",type:"property-rental-start",assetId:"rental-1",name:"Carryforward rental",monthlyRentalIncomeCents:1_000_000,rentalIncomeGrowthBps:0,rentalUseBps:10_000,rentalTaxModelingEnabled:true,rentalType:"long-term",buildingBasisCents:0}]},
      asOfDate:"2026-12-15",
      settings:{...settings,retirementMonth:"2027-01",withdrawalRateBps:1,horizonYears:1},
    });
    const year=result.keepHomes.years[0];

    expect(year.endingBalances).toEqual({accounts:{},assets:{},liabilities:{}});
    expect(year.warnings).toContainEqual(expect.objectContaining({code:"unsupported-rental-tax",entityId:"rental-1"}));
  });

  // Production mutation caught: honoring the override before the selected taxable destination on a shortfall drains the fallback cash account first.
  test("funds a shortfall from the taxable destination before forced fallback", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [
          {
            ...financialSnapshot.accounts[0],
            balanceCents: 500_000,
            taxableCostBasisCents: 500_000,
          },
          {
            id: "cash-1",
            name: "Cash reserve",
            kind: "checking",
            subtype: "cash",
            balanceCents: 2_000_000,
            annualReturnBps: 0,
            liquid: true,
          },
        ],
        recurring: [{
          id: "expense-1",
          name: "Living expenses",
          amountCents: 100_000,
          kind: "expense",
          startDate: "2027-01-01",
          frequency: "monthly",
          annualGrowthBps: 0,
          taxTreatment: "none",
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        withdrawalRateBps: 1,
        horizonYears: 1,
        withdrawalAccountOrder: ["cash-1", "taxable-1"],
      },
    });
    const year = result.keepHomes.years[0];

    expect(year.withdrawalTargetCents).toBe(250);
    expect(year.shortfallCents).toBe(1_199_750);
    expect(year.withdrawalSources.map((source) => [source.accountId, source.amountCents])).toEqual([
      ["cash-1", 250],
      ["taxable-1", 500_000],
      ["cash-1", 699_750],
    ]);
    expect(year.endingBalances.accounts).toEqual({
      "taxable-1": 0,
      "cash-1": 1_300_000,
    });
  });

  // Production mutation caught: sequential sale tax or a missing cost, payoff, proceeds deposit, or basis deposit changes the exact sale result and first withdrawal character.
  test("sells all homes together at retirement and deposits exact net proceeds with basis", () => {
    const homeSnapshot: FinancialSnapshot = {
      ...financialSnapshot,
      accounts: [{
        ...financialSnapshot.accounts[0],
        balanceCents: 5_000_000,
        taxableCostBasisCents: 5_000_000,
      }],
      assets: [
        {
          id: "rental-1",
          name: "Rental home",
          valueCents: 10_000_000,
          annualGrowthBps: 0,
          purchasePriceCents: 5_000_000,
          purchaseDate: "2020-01-01",
          rentalTaxBasisCents: 5_000_000,
          housingCosts: {
            propertyTaxRateBps: 0,
            insuranceMonthlyCents: 0,
            insuranceAnnualGrowthBps: 0,
            hoaMonthlyCents: 0,
            hoaAnnualGrowthBps: 0,
          },
          homeSaleAssumptions: {
            sellingCostBps: 500,
            primaryResidenceExclusionEligible: false,
            accumulatedFederalDepreciationCents: 0,
            accumulatedCaliforniaDepreciationCents: 0,
          },
        },
        {
          id: "home-2",
          name: "Primary home",
          valueCents: 20_000_000,
          annualGrowthBps: 0,
          purchasePriceCents: 10_000_000,
          purchaseDate: "2020-01-01",
          housingStartDate: "2020-01-01",
          homeSaleAssumptions: {
            sellingCostBps: 500,
            primaryResidenceExclusionEligible: true,
            accumulatedFederalDepreciationCents: 0,
            accumulatedCaliforniaDepreciationCents: 0,
          },
        },
      ],
      liabilities: [{
        id: "mortgage-1",
        name: "Rental mortgage",
        balanceCents: 3_000_000,
        annualRateBps: 0,
        minimumPaymentCents: 0,
        mortgage: {
          originalPrincipalCents: 3_000_000,
          termMonths: 360,
          startDate: "2020-01-01",
          assetId: "rental-1",
        },
      }],
    };
    const result = calculateRetirementProjection({
      snapshot: homeSnapshot,
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        horizonYears: 2,
      },
    });

    expect(result.sellHomes.available).toBe(true);
    if (!result.sellHomes.available) throw new Error("expected Sell homes to be available");
    const [saleYear, nextYear] = result.sellHomes.years;
    expect(saleYear.startingPortfolioCents).toBe(30_383_930);
    expect(saleYear.withdrawalTargetCents).toBe(911_518);
    expect(saleYear.homeSale).toEqual({
      grossSaleValueCents: 30_000_000,
      sellingCostsCents: 1_500_000,
      mortgagePayoffCents: 3_000_000,
      incrementalSaleTaxCents: 116_070,
      netProceedsCents: 25_383_930,
    });
    expect(saleYear.withdrawalSources[0].taxableGainCents).toBe(0);
    expect(saleYear.destinationBalanceCents).toBe(30_383_930);
    for (const year of [saleYear, nextYear]) {
      expect(year.endingBalances.assets).toEqual({});
      expect(year.endingBalances.liabilities).toEqual({});
      expect(year.rentalIncomeCents).toBe(0);
      expect(year.housingExpenseCents).toBe(0);
      expect(year.housing).toEqual({
        principalCents: 0,
        interestCents: 0,
        propertyTaxCents: 0,
        insuranceCents: 0,
        hoaCents: 0,
        maintenanceCents: 0,
      });
    }
    expect(nextYear.homeSale).toBeUndefined();
  });

  // Production mutation caught: making missing sale metadata invalidate both scenarios hides a complete Keep projection instead of scoping the issue to Sell.
  test("keeps the Keep scenario available when Sell home data is incomplete", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        assets: [{
          id: "home-1",
          name: "Incomplete home",
          valueCents: 20_000_000,
          annualGrowthBps: 0,
          housingStartDate: "2020-01-01",
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        horizonYears: 1,
      },
    });

    expect(result.keepHomes.available).toBe(true);
    expect(result.keepHomes.years).toHaveLength(1);
    expect(result.sellHomes).toMatchObject({
      available: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ assetId: "home-1", field: "purchaseDate" }),
      ]),
    });
  });

  // Production mutation caught: accepting a missing taxable destination silently drops surplus and home-sale proceeds without an actionable result warning.
  test("warns when the taxable destination is missing", () => {
    const result = calculateRetirementProjection({
      snapshot: financialSnapshot,
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        horizonYears: 1,
        taxableDestinationAccountId: null,
      },
    });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: "missing-destination",
      year: 2027,
    }));
    expect(result.keepHomes.years[0].warnings).toContainEqual(expect.objectContaining({
      code: "missing-destination",
    }));
    expect(result.keepHomes.years[0].warnings).toContainEqual(expect.objectContaining({
      code: "calculation-error",
    }));
    expect(result.keepHomes.years[0].endingBalances).toEqual({ accounts: {}, assets: {}, liabilities: {} });
  });

  // Production mutation caught: depositing negative net sale proceeds directly creates a negative brokerage and basis instead of funding the closing deficit through normal withdrawals.
  test("funds negative home-sale proceeds without creating a negative destination", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{ ...financialSnapshot.accounts[0], balanceCents: 2_000_000, taxableCostBasisCents: 2_000_000 }],
        assets: [{
          id: "underwater-home",
          name: "Underwater home",
          valueCents: 10_000_000,
          annualGrowthBps: 0,
          purchasePriceCents: 10_000_000,
          purchaseDate: "2020-01-01",
          housingStartDate: "2020-01-01",
          homeSaleAssumptions: {
            sellingCostBps: 0,
            primaryResidenceExclusionEligible: true,
            accumulatedFederalDepreciationCents: 0,
            accumulatedCaliforniaDepreciationCents: 0,
          },
        }],
        liabilities: [{
          id: "underwater-mortgage",
          name: "Underwater mortgage",
          balanceCents: 15_000_000,
          annualRateBps: 0,
          minimumPaymentCents: 0,
          mortgage: { originalPrincipalCents: 15_000_000, termMonths: 360, startDate: "2020-01-01", assetId: "underwater-home" },
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });
    expect(result.sellHomes.available).toBe(true);
    if (!result.sellHomes.available) throw new Error("expected Sell homes to be available");
    const year = result.sellHomes.years[0];

    expect(year.homeSale?.netProceedsCents).toBe(-5_000_000);
    expect(year.shortfallCents).toBe(5_000_000);
    expect(year.endingBalances.accounts["taxable-1"]).toBe(0);
    expect(year.endingNetWorthCents).toBe(0);
    expect(year.warnings).toContainEqual(expect.objectContaining({
      code: "unfunded-spending",
      message: "3000000 cents of spending could not be funded.",
    }));
  });

  // Production mutation caught: omitting household people from the draw classifies a young owner's IRA as penalty-free and can hide that the account was exhausted.
  test("reports owner-specific early withdrawal and account depletion", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        household: {
          ...financialSnapshot.household,
          people: [{ id: "person-1", name: "Morgan", birthDate: "2000-06-15" }],
        },
        accounts: [
          {
            ...financialSnapshot.accounts[0],
            balanceCents: 0,
            taxableCostBasisCents: 0,
          },
          {
            id: "ira-1",
            name: "Morgan IRA",
            kind: "retirement",
            subtype: "traditional-ira",
            ownerPersonId: "person-1",
            balanceCents: 1_000_000,
            annualReturnBps: 0,
            liquid: true,
          },
        ],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        withdrawalRateBps: 10_000,
        horizonYears: 1,
        withdrawalAccountOrder: ["ira-1", "taxable-1"],
      },
    });
    const year = result.keepHomes.years[0];

    expect(year.earlyPenaltyCents).toBe(100_000);
    expect(year.estimatedTaxCents).toBe(4_005);
    expect(year.withdrawalSources[0]).toMatchObject({
      accountId: "ira-1",
      amountCents: 1_000_000,
      ordinaryIncomeCents: 1_000_000,
      earlyPenaltyCents: 100_000,
    });
    expect(year.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "early-withdrawal", year: 2027 }),
      expect.objectContaining({ code: "account-depleted", year: 2027, entityId: "ira-1" }),
    ]));
  });

  // Production mutation caught: presenting an aggregate brokerage gain as exact long-term gain invents holding-period and California-basis precision that the account does not contain.
  test("returns a structured calculation error when taxable lot character is unavailable", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{
          ...financialSnapshot.accounts[0],
          balanceCents: 100_000_000,
          taxableCostBasisCents: 50_000_000,
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", horizonYears: 1 },
    });
    const year = result.keepHomes.years[0];

    expect(year.endingBalances).toEqual({ accounts: {}, assets: {}, liabilities: {} });
    expect(year.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported-tax-character", year: 2027, entityId: "taxable-1" }),
      expect.objectContaining({ code: "calculation-error", year: 2027 }),
    ]));
  });

  // Production mutation caught: treating a pre-retirement contribution as market growth rescales a stale lot to the cutoff balance and invents exact gain character.
  test("rejects stale lots when account activity evolves the cutoff balance", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{
          ...financialSnapshot.accounts[0],
          balanceCents: 100_000_000,
          taxableCostBasisCents: 50_000_000,
          taxLots: [{ id: "old-lot", acquiredOn: "2020-01-01", marketValueCents: 100_000_000, federalBasisCents: 50_000_000, californiaBasisCents: 50_000_000 }],
        }],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [{ id: "cutoff-contribution", date: "2026-12-01", type: "account-contribution", accountId: "taxable-1", amountCents: 10_000_000 }],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });

    expect(result.keepHomes.years[0].endingBalances).toEqual({ accounts: {}, assets: {}, liabilities: {} });
    expect(result.keepHomes.years[0].warnings).toContainEqual(expect.objectContaining({
      code: "unsupported-tax-character",
      entityId: "taxable-1",
    }));
  });

  // Production mutation caught: normalizing a mismatched lot total or treating an invalid acquisition date as short-term presents unsupported metadata as exact tax.
  test.each([
    ["mismatched total", [{ id: "bad-total", acquiredOn: "2020-01-01", marketValueCents: 90_000_000, federalBasisCents: 45_000_000, californiaBasisCents: 45_000_000 }]],
    ["invalid acquisition date", [{ id: "bad-date", acquiredOn: "2020-02-30", marketValueCents: 100_000_000, federalBasisCents: 50_000_000, californiaBasisCents: 50_000_000 }]],
  ] as const)("rejects %s in taxable lots", (_label, taxLots) => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{ ...financialSnapshot.accounts[0], taxableCostBasisCents: 50_000_000, taxLots }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1 },
    });

    expect(result.keepHomes.years[0].warnings).toContainEqual(expect.objectContaining({
      code: "unsupported-tax-character",
      entityId: "taxable-1",
    }));
  });

  // Production mutation caught: reducing taxable lots for a Plan transfer without reporting its sale character silently treats a taxable disposition as tax-free.
  test("returns structured unsupported tax for a post-retirement taxable Plan outflow", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [
          {
            ...financialSnapshot.accounts[0],
            taxableCostBasisCents: 50_000_000,
          },
          { id: "cash-1", name: "Cash", kind: "checking", subtype: "cash", balanceCents: 100_000_000, annualReturnBps: 0, liquid: true },
        ],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [{ id: "taxable-transfer", date: "2027-03-01", type: "account-transfer", fromAccountId: "taxable-1", toAccountId: "cash-1", amountCents: 10_000_000 }],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", withdrawalRateBps: 1, horizonYears: 1, withdrawalAccountOrder: ["cash-1", "taxable-1"] },
    });

    expect(result.keepHomes.years[0].endingBalances).toEqual({ accounts: {}, assets: {}, liabilities: {} });
    expect(result.keepHomes.years[0].warnings).toContainEqual(expect.objectContaining({
      code: "unsupported-tax-character",
      entityId: "taxable-1",
    }));
  });

  // Production mutation caught: discarding the final unfunded draw amount presents a depleted portfolio as if all spending were covered.
  test("warns when spending remains unfunded after every account is depleted", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{
          ...financialSnapshot.accounts[0],
          balanceCents: 100_000,
          taxableCostBasisCents: 100_000,
        }],
        recurring: [{
          id: "expense-1",
          name: "Living expenses",
          amountCents: 100_000,
          kind: "expense",
          startDate: "2027-01-01",
          frequency: "monthly",
          annualGrowthBps: 0,
          taxTreatment: "none",
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        withdrawalRateBps: 1,
        horizonYears: 1,
      },
    });
    const year = result.keepHomes.years[0];

    expect(year.shortfallCents).toBe(1_199_990);
    expect(year.endingBalances.accounts["taxable-1"]).toBe(0);
    expect(year.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "account-depleted", entityId: "taxable-1" }),
      expect.objectContaining({ code: "unfunded-spending", year: 2027 }),
    ]));
  });

  // Production mutation caught: stopping tax gross-up after eight geometric passes reports a fundable high-rate early distribution as unfunded.
  test("grosses up a high-rate early pre-tax shortfall to the cent", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        household: {
          ...financialSnapshot.household,
          people: [{ id: "person-1", name: "Morgan", birthDate: "2000-06-15" }],
        },
        accounts: [
          { ...financialSnapshot.accounts[0], balanceCents: 0, taxableCostBasisCents: 0 },
          { id: "ira-1", name: "Morgan IRA", kind: "retirement", subtype: "traditional-ira", ownerPersonId: "person-1", balanceCents: 500_000_000, annualReturnBps: 0, liquid: true },
        ],
        recurring: [{
          id: "expense-1",
          name: "Living expenses",
          amountCents: 10_000_000,
          kind: "expense",
          startDate: "2027-01-01",
          frequency: "monthly",
          annualGrowthBps: 0,
          taxTreatment: "none",
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        withdrawalRateBps: 1,
        horizonYears: 1,
        withdrawalAccountOrder: ["ira-1", "taxable-1"],
      },
    });
    const year = result.keepHomes.years[0];

    expect(year.withdrawalSources.reduce((sum, source) => sum + source.amountCents, 0)).toBe(277_120_458);
    expect(year.estimatedTaxCents).toBe(129_408_412);
    expect(year.earlyPenaltyCents).toBe(27_712_046);
    expect(year.afterTaxIncomeCents).toBe(120_000_000);
    expect(year.warnings).not.toContainEqual(expect.objectContaining({ code: "unfunded-spending" }));
  });

  // Production mutation caught: extending an explicit end date invents pension payments after June and removes the activity-ended disclosure.
  test("preserves explicit recurring end dates and warns in the ending year", () => {
    const endingSnapshot: FinancialSnapshot = {
      ...financialSnapshot,
      recurring: [{
        id: "pension-1",
        name: "Bridge pension",
        amountCents: 100_000,
        kind: "income",
        incomeTaxCategory: "nontaxable",
        startDate: "2027-01-01",
        endDate: "2027-06-30",
        frequency: "monthly",
        annualGrowthBps: 0,
        taxTreatment: "none",
      }],
    };
    const before = JSON.stringify(endingSnapshot.recurring);
    const result = calculateRetirementProjection({
      snapshot: endingSnapshot,
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: {
        ...settings,
        retirementMonth: "2027-01",
        withdrawalRateBps: 1,
        horizonYears: 2,
      },
    });

    expect(result.keepHomes.years[0].otherPreTaxIncomeCents).toBe(600_000);
    expect(result.keepHomes.years[1].otherPreTaxIncomeCents).toBe(0);
    expect(result.keepHomes.years[0].warnings).toContainEqual(expect.objectContaining({
      code: "activity-ended",
      year: 2027,
      entityId: "pension-1",
    }));
    expect(JSON.stringify(endingSnapshot.recurring)).toBe(before);
  });

  // Production mutation caught: reusing the prior successful result after unsafe account growth displays stale balances instead of a year-scoped calculation error.
  test("clears financial rows on a year-specific calculation error", () => {
    const prior = calculateRetirementProjection({
      snapshot: financialSnapshot,
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", horizonYears: 1 },
    });
    const failed = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        accounts: [{
          ...financialSnapshot.accounts[0],
          annualReturnBps: 1_000_000_000_000,
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", horizonYears: 1 },
    });
    const failedYear = failed.keepHomes.years[0];

    expect(prior.keepHomes.years[0].endingBalances.accounts).not.toEqual({});
    expect(failedYear.endingBalances).toEqual({ accounts: {}, assets: {}, liabilities: {} });
    expect(failedYear.warnings).toContainEqual(expect.objectContaining({
      code: "calculation-error",
      year: 2027,
    }));
    expect(failed.warnings).toContainEqual(expect.objectContaining({
      code: "calculation-error",
      year: 2027,
    }));
  });

  // Production mutation caught: allowing an upfront Plan validation exception to escape prevents either retirement scenario from returning structured errors.
  test("isolates an upfront Plan exception into calculation-error scenario rows", () => {
    const invalidPlan: Scenario = {
      ...scenario,
      horizon: { start: "2026-12", months: 12 },
      contributions: [{
        id: "invalid-zero",
        destinationType: "account",
        destinationId: "taxable-1",
        percentBps: 0,
        frequency: "monthly",
      }],
    };

    const result = calculateRetirementProjection({
      snapshot: financialSnapshot,
      scenario: invalidPlan,
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", horizonYears: 2 },
    });

    expect(result.keepHomes.years).toHaveLength(2);
    expect(result.keepHomes.years.every((year) =>
      year.warnings.some((warning) => warning.code === "calculation-error"))).toBe(true);
    expect(result.sellHomes.available).toBe(false);
    if (result.sellHomes.available) throw new Error("expected Sell homes to be unavailable");
    expect(result.sellHomes.warnings).toContainEqual(expect.objectContaining({
      code: "calculation-error",
    }));
  });

  // Production mutation caught: calculating a malformed Sell disposition before Keep makes a Sell-only home-tax failure erase the valid Keep scenario.
  test("keeps Keep available when Sell setup fails", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        assets: [{
          id: "home",
          name: "Home",
          valueCents: 50_000_000,
          annualGrowthBps: 0,
          purchasePriceCents: 40_000_000,
          purchaseDate: "2020-01-01",
          homeSaleAssumptions: {
            sellingCostBps: 15_000,
            primaryResidenceExclusionEligible: true,
            accumulatedFederalDepreciationCents: 0,
            accumulatedCaliforniaDepreciationCents: 0,
          },
        }],
      },
      scenario: { ...scenario, horizon: { start: "2026-12", months: 12 } },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", horizonYears: 1 },
    });

    expect(result.keepHomes.years[0].endingBalances.assets.home).toBe(50_000_000);
    expect(result.keepHomes.years[0].warnings).not.toContainEqual(expect.objectContaining({
      code: "calculation-error",
    }));
    expect(result.sellHomes.available).toBe(false);
    if (result.sellHomes.available) throw new Error("expected Sell homes to be unavailable");
    expect(result.sellHomes.warnings).toContainEqual(expect.objectContaining({
      code: "calculation-error",
    }));
  });

  // Production mutation caught: one invalid second-year Plan event aborts the eager projection, erases the valid first row, or lets later rows reuse stale balances.
  test("preserves prior rows and clears the failing and later years after a later Plan exception", () => {
    const result = calculateRetirementProjection({
      snapshot: {
        ...financialSnapshot,
        assets: [{
          id: "home",
          name: "Home",
          valueCents: 50_000_000,
          annualGrowthBps: 0,
          housingCosts: { propertyTaxRateBps: 0, insuranceMonthlyCents: 0, insuranceAnnualGrowthBps: 0, hoaMonthlyCents: 0, hoaAnnualGrowthBps: 0 },
        }],
      },
      scenario: {
        ...scenario,
        horizon: { start: "2026-12", months: 12 },
        events: [{
          id: "invalid-adu",
          date: "2028-01-01",
          type: "adu-build",
          assetId: "home",
          name: "Invalid ADU",
          costCents: 0,
          homeSquareFeet: 0,
          aduSquareFeet: 500,
          fundingAccountId: "taxable-1",
        }],
      },
      asOfDate: "2026-12-15",
      settings: { ...settings, retirementMonth: "2027-01", horizonYears: 3 },
    });

    expect(result.keepHomes.years[0].endingBalances.accounts["taxable-1"]).toBeGreaterThan(0);
    expect(result.keepHomes.years[0].warnings).not.toContainEqual(expect.objectContaining({ code: "calculation-error" }));
    expect(result.keepHomes.years[1].endingBalances).toEqual({ accounts: {}, assets: {}, liabilities: {} });
    expect(result.keepHomes.years[1].warnings).toContainEqual(expect.objectContaining({ code: "calculation-error", year: 2028 }));
    expect(result.keepHomes.years[2].endingBalances).toEqual({ accounts: {}, assets: {}, liabilities: {} });
    expect(result.keepHomes.years[2].warnings).toContainEqual(expect.objectContaining({ code: "calculation-error", year: 2029 }));
  });
});
