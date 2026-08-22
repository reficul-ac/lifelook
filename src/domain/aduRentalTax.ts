import type { AduBuildEvent, BasisPoints, Cents } from "./types";

export interface ResolvedAduRentalTax {
  enabled: boolean;
  allocationNumerator: number;
  allocationDenominator: number;
  allocationBps: BasisPoints;
  buildingBasisCents: Cents;
  monthlyDepreciationCents: Cents;
  rentalType: "long-term" | "short-term";
  nonPassive: boolean;
}

const isNonNegativeSafeInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;

function validateBaseEvent(event: AduBuildEvent): void {
  if (!Number.isInteger(event.homeSquareFeet) || event.homeSquareFeet <= 0) {
    throw new RangeError("ADU home square footage must be a positive integer");
  }
  if (!Number.isInteger(event.aduSquareFeet) || event.aduSquareFeet <= 0) {
    throw new RangeError("ADU square footage must be a positive integer");
  }
  if (!isNonNegativeSafeInteger(event.costCents)) {
    throw new RangeError("ADU construction cost must be a non-negative safe integer number of cents");
  }
}

export function resolveAduRentalTax(event: AduBuildEvent): ResolvedAduRentalTax {
  validateBaseEvent(event);

  const details = event.rentalTaxDetails;
  const enabled = details?.rentalTaxModelingEnabled === true;
  const rentalType = details?.rentalType ?? "long-term";
  const defaultNumerator = event.aduSquareFeet;
  const defaultDenominator = event.homeSquareFeet + event.aduSquareFeet;

  if (!enabled) {
    return {
      enabled: false,
      allocationNumerator: defaultNumerator,
      allocationDenominator: defaultDenominator,
      allocationBps: Math.round(defaultNumerator * 10_000 / defaultDenominator),
      buildingBasisCents: event.costCents,
      monthlyDepreciationCents: Math.round(event.costCents / 330),
      rentalType,
      nonPassive: false,
    };
  }

  if (!isNonNegativeSafeInteger(event.monthlyRentalIncomeCents ?? -1) || event.monthlyRentalIncomeCents === 0) {
    throw new RangeError("ADU tax modeling requires positive monthly rental income");
  }
  if (details.rentalType !== "long-term" && details.rentalType !== "short-term") {
    throw new RangeError("ADU rental type must be long-term or short-term");
  }

  const override = details.rentalUseBpsOverride;
  if (override != null && (!Number.isSafeInteger(override) || override < 1 || override > 10_000)) {
    throw new RangeError("ADU rental-use override must be an integer from 1 to 10000 basis points");
  }
  const basis = details.buildingBasisCentsOverride ?? event.costCents;
  if (!isNonNegativeSafeInteger(basis)) {
    throw new RangeError("ADU building-basis override must be a non-negative safe integer number of cents");
  }

  let nonPassive: boolean;
  if (details.rentalType === "short-term") {
    if (typeof details.shortTermMaterialParticipation !== "boolean") {
      throw new RangeError("Short-term ADU tax modeling requires a material-participation answer");
    }
    nonPassive = details.shortTermMaterialParticipation;
  } else {
    if (typeof details.longTermRealEstateProfessional !== "boolean") {
      throw new RangeError("Long-term ADU tax modeling requires a real-estate-professional answer");
    }
    if (typeof details.longTermMaterialParticipation !== "boolean") {
      throw new RangeError("Long-term ADU tax modeling requires a material-participation answer");
    }
    nonPassive = details.longTermRealEstateProfessional && details.longTermMaterialParticipation;
  }

  const allocationNumerator = override ?? defaultNumerator;
  const allocationDenominator = override == null ? defaultDenominator : 10_000;
  return {
    enabled: true,
    allocationNumerator,
    allocationDenominator,
    allocationBps: Math.round(allocationNumerator * 10_000 / allocationDenominator),
    buildingBasisCents: basis,
    monthlyDepreciationCents: Math.round(basis / 330),
    rentalType: details.rentalType,
    nonPassive,
  };
}

export function allocateAduSharedExpense(cents: Cents, resolved: ResolvedAduRentalTax): Cents {
  return Math.round(cents * resolved.allocationNumerator / resolved.allocationDenominator);
}

export function combinedRentalUseExceedsFullUse(
  wholeHomeRentalUseBps: BasisPoints,
  resolved: ResolvedAduRentalTax,
): boolean {
  return wholeHomeRentalUseBps + resolved.allocationBps > 10_000;
}
