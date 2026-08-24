import { describe, expect, it } from "vitest";
import { calculateIncrementalHouseholdIncomeTax, estimateHouseholdTax, estimateTax, progressiveTax, TAX_RULES_2025, TAX_RULES_2026 } from "./tax";
import type { FilingStatus, TaxBracket, TaxRulePack } from "./types";

const input = (
  grossWageIncomeCents: number,
  federalDeductionCents = 0,
  californiaDeductionCents = federalDeductionCents,
  ficaExemptWagesCents = 0,
) => ({ grossWageIncomeCents, federalDeductionCents, californiaDeductionCents, ficaExemptWagesCents });

// Deliberately independent from production helpers: tax each bracket using integer cents.
const referenceProgressive = (amount: number, brackets: readonly TaxBracket[]) => {
  let previous = 0;
  let result = 0;
  for (const bracket of brackets) {
    const upper = bracket.upToCents ?? amount;
    const slice = Math.max(0, Math.min(amount, upper) - previous);
    result += Math.floor((slice * bracket.rateBps + 5_000) / 10_000);
    if (amount <= upper) break;
    previous = upper;
  }
  return result;
};

const reference = (gross: number, status: FilingStatus, pack: TaxRulePack, deduction = 0) => {
  const federalTaxable = Math.max(0, gross - deduction - pack.federal[status].standardDeductionCents);
  const californiaTaxable = Math.max(0, gross - deduction - pack.california[status].standardDeductionCents);
  return {
    federalCents: referenceProgressive(federalTaxable, pack.federal[status].brackets),
    californiaCents: referenceProgressive(californiaTaxable, pack.california[status].brackets),
  };
};

it("rounds every progressive bracket slice to integer cents", () => {
  expect(progressiveTax(4, [
    { upToCents: 3, rateBps: 3_333 },
    { upToCents: null, rateBps: 5_000 },
  ])).toBe(2);
});

describe.each([TAX_RULES_2025, TAX_RULES_2026])("$year tax truth boundaries", (pack) => {
  for (const status of ["single", "married-joint", "married-separate", "head-of-household"] as const) {
    it(`${status} agrees with an independent calculator one cent around every income-tax boundary`, () => {
      const boundaries = [
        pack.federal[status].standardDeductionCents,
        ...pack.federal[status].brackets.flatMap((bracket) =>
          bracket.upToCents == null ? [] : [pack.federal[status].standardDeductionCents + bracket.upToCents],
        ),
        pack.california[status].standardDeductionCents,
        ...pack.california[status].brackets.flatMap((bracket) =>
          bracket.upToCents == null ? [] : [pack.california[status].standardDeductionCents + bracket.upToCents],
        ),
      ];
      for (const boundary of boundaries) for (const delta of [-1, 0, 1]) {
        const gross = Math.max(0, boundary + delta);
        const actual = estimateTax(input(gross), status, pack);
        expect({ federalCents: actual.federalCents, californiaCents: actual.californiaCents }).toEqual(reference(gross, status, pack));
      }
    });

    it(`${status} applies payroll thresholds at exact cents`, () => {
      for (const boundary of [pack.socialSecurityWageBaseCents, pack.additionalMedicareThresholdCents[status]]) {
        for (const delta of [-1, 0, 1]) {
          const gross = boundary + delta;
          const actual = estimateTax(input(gross), status, pack);
          expect(actual.socialSecurityCents).toBe(Math.round(Math.min(gross, pack.socialSecurityWageBaseCents) * 0.062));
          expect(actual.medicareCents).toBe(Math.round(gross * 0.0145) + Math.round(Math.max(0, gross - pack.additionalMedicareThresholdCents[status]) * 0.009));
        }
      }
    });
  }
});

it("traditional retirement deductions do not reduce FICA wages", () => {
  const gross = 100_000_00;
  const without = estimateTax(input(gross), "single", TAX_RULES_2025);
  const traditional = estimateTax(input(gross, 10_000_00), "single", TAX_RULES_2025);
  expect(traditional.federalCents).toBeLessThan(without.federalCents);
  expect(traditional.californiaCents).toBeLessThan(without.californiaCents);
  expect(traditional.socialSecurityCents).toBe(without.socialSecurityCents);
  expect(traditional.medicareCents).toBe(without.medicareCents);
});

it("supports an explicit FICA exemption independently of income-tax deductions", () => {
  const actual = estimateTax(input(100_000_00, 0, 0, 10_000_00), "single", TAX_RULES_2025);
  expect(actual.socialSecurityCents).toBe(5_580_00);
  expect(actual.medicareCents).toBe(1_305_00);
});

it("rejects ambiguous or unsafe taxability inputs", () => {
  expect(() => estimateTax(input(-1), "single", TAX_RULES_2025)).toThrow(/non-negative/);
  expect(() => estimateTax(input(100, 101), "single", TAX_RULES_2025)).toThrow(/cannot exceed/);
  expect(() => estimateTax(input(Number.MAX_SAFE_INTEGER + 1), "single", TAX_RULES_2025)).toThrow(/safe integer/);
});

it("exposes federal and modified AGI for incremental tax stacking",()=>{
  const args={year:2026,status:"single" as const,employees:[{personId:"employee",salaryCents:100_000_00,rsuCents:20_000_00}],nonWageTaxableCents:30_000_00,deductions:{traditionalRetirementCents:10_000_00},thresholdInflationBps:250};
  const expectedAgi=140_000_00;

  expect(estimateHouseholdTax(args)).toEqual(expect.objectContaining({
    federalAgiCents:expectedAgi,
    modifiedAgiCents:expectedAgi,
  }));
});

// Production mutation caught: using the federal debt ceiling for California,
// or leaving California interest uncapped, produces the wrong jurisdictional deductions.
it("caps federal and California mortgage interest at their filing-status debt limits",()=>{
  const joint=estimateHouseholdTax({
    year:2026,
    status:"married-joint",
    employees:[{personId:"a",salaryCents:100_000_00,rsuCents:0},{personId:"b",salaryCents:100_000_00,rsuCents:0}],
    deductions:{mortgageInterestCents:24_000_00,mortgageDebtCents:1_500_000_00},
    thresholdInflationBps:250,
  });
  expect(joint.federalMortgageInterestDeductionCents).toBe(12_000_00);
  expect(joint.californiaMortgageInterestDeductionCents).toBe(16_000_00);

  const separate=estimateHouseholdTax({
    year:2026,
    status:"married-separate",
    employees:[],
    deductions:{mortgageInterestCents:24_000_00,mortgageDebtCents:1_500_000_00},
    thresholdInflationBps:250,
  });
  expect(separate.federalMortgageInterestDeductionCents).toBe(6_000_00);
  expect(separate.californiaMortgageInterestDeductionCents).toBe(8_000_00);
});

// Production mutation caught: applying full personal mortgage interest or uncapped property tax bypasses the shared household deduction limits in retirement tax.
it("applies household mortgage and SALT limits to incremental personal housing deductions",()=>{
  const result=calculateIncrementalHouseholdIncomeTax({
    year:2026,
    status:"single",
    thresholdInflationBps:250,
    baseline:{
      federalAgiCents:0,
      modifiedAgiCents:0,
      federalTaxableCents:0,
      californiaTaxableCents:0,
      federalCents:0,
      californiaCents:0,
      federalStandardCents:TAX_RULES_2026.federal.single.standardDeductionCents,
      federalItemizedCents:0,
      californiaStandardCents:TAX_RULES_2026.california.single.standardDeductionCents,
      californiaItemizedCents:0,
    },
    federalOrdinaryIncomeCents:10_000_000,
    californiaOrdinaryIncomeCents:7_000_000,
    federalShortTermGainCents:0,
    federalLongTermGainCents:0,
    californiaCapitalGainCents:0,
    federalInvestmentIncomeCents:0,
    personalHousing:{mortgageInterestCents:2_000_000,mortgageDebtCents:150_000_000,propertyTaxCents:5_000_000},
  });

  expect(result.federalDeductionCents).toBe(5_040_000);
  expect(result.californiaMortgageInterestDeductionCents).toBe(1_333_333);
  expect(result.californiaDeductionCents).toBe(6_333_333);
  expect(result.federalIncomeTaxCents).toBe(570_400);
  expect(result.californiaIncomeTaxCents).toBeGreaterThan(0);
  expect(result.totalIncrementalTaxCents).toBe(result.federalIncomeTaxCents+result.californiaIncomeTaxCents);
});
