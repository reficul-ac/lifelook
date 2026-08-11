import { describe, expect, it } from "vitest";
import { estimateTax, TAX_RULES_2025, TAX_RULES_2026 } from "./tax";
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
