import { MAX_MONEY_CENTS } from "../money";
import type { AduBuildEvent, AduRentalTaxDetails, BasisPoints, Cents } from "./types";

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

  const rawDetails: unknown = event.rentalTaxDetails;
  let details: AduRentalTaxDetails | undefined;
  if (rawDetails !== undefined) {
    if (rawDetails === null || typeof rawDetails !== "object" || Array.isArray(rawDetails)) {
      throw new RangeError("ADU rental tax details must be an object");
    }
    const candidate = rawDetails as AduRentalTaxDetails;
    if (typeof candidate.rentalTaxModelingEnabled !== "boolean") {
      throw new RangeError("ADU rental tax modeling enabled flag must be a boolean");
    }
    if (candidate.rentalType !== "long-term" && candidate.rentalType !== "short-term") {
      throw new RangeError("ADU rental type must be long-term or short-term");
    }
    if (candidate.rentalUseBpsOverride != null &&
      (!Number.isSafeInteger(candidate.rentalUseBpsOverride) || candidate.rentalUseBpsOverride < 1 || candidate.rentalUseBpsOverride > 10_000)) {
      throw new RangeError("ADU rental-use override must be an integer from 1 to 10000 basis points");
    }
    if (candidate.buildingBasisCentsOverride != null &&
      (!isNonNegativeSafeInteger(candidate.buildingBasisCentsOverride) || candidate.buildingBasisCentsOverride > MAX_MONEY_CENTS)) {
      throw new RangeError("ADU building-basis override must be a non-negative safe integer number of cents within the supported money range");
    }
    details = candidate;
  }
  const rentalType = details?.rentalType ?? "long-term";
  const defaultNumerator = event.aduSquareFeet;
  const defaultDenominator = event.homeSquareFeet + event.aduSquareFeet;

  if (!details || !details.rentalTaxModelingEnabled) {
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
  const override = details.rentalUseBpsOverride;
  const basis = details.buildingBasisCentsOverride ?? event.costCents;

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
  return wholeHomeRentalUseBps / 10_000 +
    resolved.allocationNumerator / resolved.allocationDenominator > 1;
}
