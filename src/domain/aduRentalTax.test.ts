import { describe, expect, test } from "vitest";
import {
  allocateAduSharedExpense,
  combinedRentalUseExceedsFullUse,
  resolveAduRentalTax,
} from "./aduRentalTax";
import type { AduBuildEvent } from "./types";

const event: AduBuildEvent = {
  id: "garage-adu",
  date: "2028-08-19",
  type: "adu-build",
  assetId: "home",
  name: "Garage ADU",
  costCents: 60_000_00,
  homeSquareFeet: 1_500,
  aduSquareFeet: 500,
  fundingAccountId: "cash",
  monthlyRentalIncomeCents: 2_000_00,
  rentalIncomeGrowthBps: 500,
  rentalTaxDetails: {
    rentalTaxModelingEnabled: true,
    rentalType: "long-term",
    longTermRealEstateProfessional: true,
    longTermMaterialParticipation: true,
  },
};

describe("ADU rental tax assumptions", () => {
  test("uses exact square-footage allocation and construction basis by default", () => {
    const resolved = resolveAduRentalTax(event);
    expect(resolved).toMatchObject({
      enabled: true,
      allocationNumerator: 500,
      allocationDenominator: 2_000,
      allocationBps: 2_500,
      buildingBasisCents: 60_000_00,
      monthlyDepreciationCents: 18_182,
      nonPassive: true,
    });
    expect(allocateAduSharedExpense(1_000_01, resolved)).toBe(25_000);
  });

  test("uses explicit allocation and basis overrides", () => {
    const resolved = resolveAduRentalTax({
      ...event,
      rentalTaxDetails: {
        ...event.rentalTaxDetails!,
        rentalUseBpsOverride: 3_000,
        buildingBasisCentsOverride: 75_000_00,
      },
    });
    expect(resolved.allocationBps).toBe(3_000);
    expect(resolved.buildingBasisCents).toBe(75_000_00);
    expect(allocateAduSharedExpense(1_000_01, resolved)).toBe(30_000);
  });

  test("detects combined whole-home and ADU allocation above 100 percent", () => {
    expect(combinedRentalUseExceedsFullUse(8_000, resolveAduRentalTax(event)))
      .toBe(true);
  });

  test("detects combined use above 100 percent from the exact allocation fraction", () => {
    const resolved = resolveAduRentalTax({
      ...event,
      homeSquareFeet: 833_351,
      aduSquareFeet: 166_649,
    });
    expect(resolved.allocationBps).toBe(1_666);
    expect(combinedRentalUseExceedsFullUse(8_334, resolved)).toBe(true);
  });

  test("requires the participation answer for the selected rental type", () => {
    expect(() => resolveAduRentalTax({
      ...event,
      rentalTaxDetails: {
        rentalTaxModelingEnabled: true,
        rentalType: "short-term",
      },
    })).toThrow("Short-term ADU tax modeling requires a material-participation answer");
  });

  test("returns disabled without inferring participation when details are absent", () => {
    const resolved = resolveAduRentalTax({
      ...event,
      rentalTaxDetails: undefined,
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.nonPassive).toBe(false);
  });

  test("validates present rental tax details structurally when modeling is disabled", () => {
    const invalidDetails: readonly (readonly [string, unknown, string])[] = [
      ["non-object details", null, "ADU rental tax details must be an object"],
      ["non-boolean enable flag", { rentalTaxModelingEnabled: "false", rentalType: "long-term" }, "ADU rental tax modeling enabled flag must be a boolean"],
      ["invalid rental type", { rentalTaxModelingEnabled: false, rentalType: "vacation" }, "ADU rental type must be long-term or short-term"],
      ["non-numeric rental-use override", { rentalTaxModelingEnabled: false, rentalType: "long-term", rentalUseBpsOverride: "3000" }, "ADU rental-use override must be an integer from 1 to 10000 basis points"],
      ["basis above the supported money range", { rentalTaxModelingEnabled: false, rentalType: "long-term", buildingBasisCentsOverride: 100_000_000_000_000 }, "ADU building-basis override must be a non-negative safe integer number of cents within the supported money range"],
    ];
    for (const [name, rentalTaxDetails, message] of invalidDetails) {
      expect(() => resolveAduRentalTax({
        ...event,
        rentalTaxDetails,
      } as unknown as AduBuildEvent), name).toThrow(message);
    }
  });

  test("requires positive rent when tax modeling is enabled", () => {
    expect(() => resolveAduRentalTax({
      ...event,
      monthlyRentalIncomeCents: 0,
    })).toThrow("ADU tax modeling requires positive monthly rental income");
  });

  test("rejects an allocation override outside one through ten thousand basis points", () => {
    expect(() => resolveAduRentalTax({
      ...event,
      rentalTaxDetails: {
        ...event.rentalTaxDetails!,
        rentalUseBpsOverride: 0,
      },
    })).toThrow("ADU rental-use override must be an integer from 1 to 10000 basis points");
  });

  test("rejects a negative basis override", () => {
    expect(() => resolveAduRentalTax({
      ...event,
      rentalTaxDetails: {
        ...event.rentalTaxDetails!,
        buildingBasisCentsOverride: -1,
      },
    })).toThrow("ADU building-basis override must be a non-negative safe integer number of cents");
  });

  test("requires both long-term participation answers", () => {
    expect(() => resolveAduRentalTax({
      ...event,
      rentalTaxDetails: {
        rentalTaxModelingEnabled: true,
        rentalType: "long-term",
        longTermMaterialParticipation: true,
      },
    })).toThrow("Long-term ADU tax modeling requires a real-estate-professional answer");
  });
});
