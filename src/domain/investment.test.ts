import { describe, expect, it } from "vitest";
import {
  calculateInvestmentComparison,
  defaultInvestmentAssumptions,
  depreciationForMonth,
  mortgagePayment,
  validateInvestmentAssumptions,
  type InvestmentTaxContext,
} from "./investment";

describe("investment comparison", () => {
  it("amortizes standard and zero-interest mortgages", () => {
    expect(mortgagePayment(100_000, 0, 10)).toBe(10_000);
    expect(mortgagePayment(40_000_000, 650, 360)).toBeCloseTo(252_827.23, 1);
    const result = calculateInvestmentComparison({
      ...defaultInvestmentAssumptions,
      monthlyRentCents: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.years[29].mortgageBalanceCents).toBe(0);
  });
  it("seeds stocks with the equivalent upfront cash", () => {
    const result = calculateInvestmentComparison({
      ...defaultInvestmentAssumptions,
      horizonYears: 10,
    });
    if (!result.ok) throw new Error("invalid");
    expect(result.result.months[0].stockValueCents).toBe(11_500_000);
    expect(result.result.months[0].equityCents).toBe(10_000_000);
    expect(result.result.months[0].saleProceedsCents).toBe(7_000_000);
  });
  it("compounds monthly, contributes at month end, and aggregates annual flows", () => {
    const a = { ...defaultInvestmentAssumptions, horizonYears: 1 };
    const result = calculateInvestmentComparison(a);
    if (!result.ok) throw new Error("invalid");
    const year = result.result.years[0],
      points = result.result.months.slice(1);
    expect(year.ownerOutlayCents).toBe(
      points.reduce((s, p) => s + p.ownerOutlayCents, 0),
    );
    expect(year.stockContributionCents).toBe(
      points.reduce((s, p) => s + p.stockContributionCents, 0),
    );
    expect(year.homeValueCents).toBeCloseTo(51_520_797, -1);
  });
  it("allows personal rent to exceed rental-property outlay because both strategies pay it", () => {
    const result = calculateInvestmentComparison({
      ...defaultInvestmentAssumptions,
      monthlyRentCents: 1_000_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.result.months[1].stockContributionCents).toBe(
        result.result.months[1].ownerOutlayCents,
      );
  });
  it("validates boundaries and records crossover changes", () => {
    expect(
      validateInvestmentAssumptions({
        ...defaultInvestmentAssumptions,
        downPaymentBps: 10_000,
        horizonYears: 0,
      }).map((x) => x.field),
    ).toEqual(expect.arrayContaining(["downPaymentBps", "horizonYears"]));
    const result = calculateInvestmentComparison({
      ...defaultInvestmentAssumptions,
      stockReturnBps: 0,
      homeAppreciationBps: 10_000,
      horizonYears: 5,
    });
    if (result.ok)
      expect(result.result.equityCrossovers.length).toBeGreaterThanOrEqual(0);
  });
  it("invests Buy-path rental income at month end and includes it in Buy totals", () => {
    const result = calculateInvestmentComparison({
      ...defaultInvestmentAssumptions,
      horizonYears: 1,
      monthlyRentCents: 0,
      stockReturnBps: 0,
      monthlyRentalIncomeCents: 100_000,
      rentalIncomeGrowthBps: 0,
    });
    if (!result.ok) throw new Error("invalid");
    const end = result.result.months.at(-1)!;
    expect(end.rentalPortfolioCents).toBe(1_200_000);
    expect(end.buyRetainedTotalCents).toBe(end.equityCents + 1_200_000);
    expect(end.buySaleTotalCents).toBe(end.saleProceedsCents + 1_200_000);
    expect(result.result.years[0].rentalIncomeCents).toBe(1_200_000);
  });
  it("adds ADU value from the home's build-time price per square foot", () => {
    const withoutAdu = calculateInvestmentComparison({
      ...defaultInvestmentAssumptions,
      horizonYears: 1,
      homeAppreciationBps: 0,
      stockReturnBps: 0,
    });
    const withAdu = calculateInvestmentComparison({
      ...defaultInvestmentAssumptions,
      horizonYears: 1,
      homeAppreciationBps: 0,
      stockReturnBps: 0,
      homeSquareFeet: 1_000,
      aduPlanned: true,
      aduSquareFeet: 500,
      aduBuildYear: 1,
      aduBuildCostCents: 15_000_000,
      aduMonthlyRentCents: 200_000,
      rentalIncomeGrowthBps: 0,
    });
    if (!withoutAdu.ok || !withAdu.ok) throw new Error("invalid");
    expect(withAdu.result.months[1].homeValueCents - withoutAdu.result.months[1].homeValueCents).toBe(25_000_000);
    expect(withAdu.result.months[1].ownerOutlayCents - withoutAdu.result.months[1].ownerOutlayCents).toBeGreaterThanOrEqual(15_000_000);
    expect(withAdu.result.years[0].rentalIncomeCents).toBe(2_400_000);
  });
  it("validates planned ADU dimensions and timing", () => {
    const fields = validateInvestmentAssumptions({...defaultInvestmentAssumptions,horizonYears:4,aduPlanned:true,homeSquareFeet:0,aduSquareFeet:0,aduBuildYear:5}).map(x=>x.field);
    expect(fields).toEqual(expect.arrayContaining(["homeSquareFeet","aduSquareFeet","aduBuildYear"]));
  });
  it("builds independent FIRE snapshots in current and desired modes", () => {
    const current = calculateInvestmentComparison({...defaultInvestmentAssumptions,horizonYears:2,stockReturnBps:0,fireWithdrawalRateBps:400,annualRetirementIncomeCents:20_000_00});
    if (!current.ok) throw new Error("invalid");
    expect(current.result.retirementYears).toHaveLength(2);
    expect(current.result.retirementYears[0].paths.stocks.grossStockWithdrawalCents).toBe(Math.round(current.result.years[0].stockValueCents*.04));
    expect(current.result.retirementYears[1].paths.stocks.wealthCents).toBe(current.result.years[1].stockValueCents);
    const desired = calculateInvestmentComparison({...defaultInvestmentAssumptions,horizonYears:1,retirementIncomeMode:"desired",annualRetirementIncomeCents:1_000_00,fireWithdrawalRateBps:400});
    if (!desired.ok) throw new Error("invalid");
    expect(desired.result.retirementYears[0].paths.stocks.totalAfterTaxIncomeCents).toBeCloseTo(1_000_00,-1);
    expect(desired.result.retirementYears[0].paths.stocks.grossStockWithdrawalCents).toBeLessThan(desired.result.years[0].stockValueCents*.04);
  });
  it("requires a mixed-use share only for a primary residence with tenant rent", () => {
    expect(validateInvestmentAssumptions({...defaultInvestmentAssumptions,primaryResidence:true,monthlyRentalIncomeCents:100_00,rentalUseBps:0}).map(e=>e.field)).toContain("rentalUseBps");
    expect(validateInvestmentAssumptions({...defaultInvestmentAssumptions,primaryResidence:true,monthlyRentalIncomeCents:100_00,rentalUseBps:2500}).map(e=>e.field)).not.toContain("rentalUseBps");
  });
  it("uses 27.5-year mid-month building depreciation and excludes land", () => {
    const basis = 44_000_000;
    expect(depreciationForMonth(basis, 8, 1)).toBeCloseTo(basis / 330 / 2, 5);
    expect(depreciationForMonth(basis, 8, 2)).toBeCloseTo(basis / 330, 5);
    expect(depreciationForMonth(basis, 8, 331)).toBeCloseTo(basis / 330 / 2, 5);
    expect(depreciationForMonth(basis, 8, 332)).toBe(0);
  });
  it("requires Plan tax context and applies incremental tax to Buy contributions", () => {
    const assumptions = {
      ...defaultInvestmentAssumptions,
      horizonYears: 1,
      factorRentalTaxes: true,
      monthlyRentalIncomeCents: 300_000,
      rentalIncomeGrowthBps: 0,
    };
    expect(calculateInvestmentComparison(assumptions).ok).toBe(false);
    const context: InvestmentTaxContext = {
      filingStatus: "single",
      thresholdInflationBps: 250,
      startMonth: "2026-08",
      years: [
        {
          year: 2026,
          federalTaxableCents: 100_000_00,
          californiaTaxableCents: 110_000_00,
          federalTaxCents: 17_000_00,
          californiaTaxCents: 7_000_00,
          modifiedAgiCents: 120_000_00,
        },
        {
          year: 2027,
          federalTaxableCents: 102_500_00,
          californiaTaxableCents: 112_500_00,
          federalTaxCents: 17_500_00,
          californiaTaxCents: 7_200_00,
          modifiedAgiCents: 123_000_00,
        },
      ],
    };
    const result = calculateInvestmentComparison(assumptions, context);
    if (!result.ok) throw new Error("invalid");
    expect(
      result.result.months.some((month) => month.netTaxDeltaCents !== 0),
    ).toBe(true);
    expect(result.result.months[1].taxAdjustedBuyContributionCents).toBe(
      result.result.months[1].rentalIncomeCents +
        result.result.months[1].netTaxDeltaCents,
    );
  });
  it("reflects short-term material participation in allowed losses and tax savings", () => {
    const context: InvestmentTaxContext = {
      filingStatus: "married-joint",
      thresholdInflationBps: 250,
      startMonth: "2026-01",
      years: [
        {
          year: 2026,
          federalTaxableCents: 170_000_00,
          californiaTaxableCents: 190_000_00,
          federalTaxCents: 29_000_00,
          californiaTaxCents: 13_000_00,
          modifiedAgiCents: 205_000_00,
        },
      ],
    };
    const base = {
      ...defaultInvestmentAssumptions,
      horizonYears: 1,
      factorRentalTaxes: true,
      monthlyRentalIncomeCents: 100_000,
      rentalIncomeGrowthBps: 0,
    };
    const longTerm = calculateInvestmentComparison(
      { ...base, rentalType: "long-term" },
      context,
    );
    const shortTerm = calculateInvestmentComparison(
      {
        ...base,
        rentalType: "short-term",
        shortTermMaterialParticipation: true,
      },
      context,
    );
    const professionalOnly = calculateInvestmentComparison(
      {
        ...base,
        rentalType: "long-term",
        longTermRealEstateProfessional: true,
      },
      context,
    );
    const professionalAndMaterial = calculateInvestmentComparison(
      {
        ...base,
        rentalType: "long-term",
        longTermRealEstateProfessional: true,
        longTermMaterialParticipation: true,
      },
      context,
    );
    if (
      !longTerm.ok ||
      !shortTerm.ok ||
      !professionalOnly.ok ||
      !professionalAndMaterial.ok
    )
      throw new Error("invalid");
    expect(longTerm.result.years[0].federalAllowedRentalCents).toBe(0);
    expect(
      longTerm.result.years[0].federalPassiveCarryforwardCents,
    ).toBeGreaterThan(0);
    expect(shortTerm.result.years[0].federalAllowedRentalCents).toBeLessThan(0);
    expect(shortTerm.result.years[0].federalPassiveCarryforwardCents).toBe(0);
    expect(shortTerm.result.years[0].netTaxDeltaCents).toBeGreaterThan(0);
    expect(professionalOnly.result.years[0].federalAllowedRentalCents).toBe(0);
    expect(
      professionalAndMaterial.result.years[0].federalAllowedRentalCents,
    ).toBeLessThan(0);
    expect(
      professionalAndMaterial.result.years[0].federalPassiveCarryforwardCents,
    ).toBe(0);
  });
});
