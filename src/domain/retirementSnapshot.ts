import { calculateIncrementalHomeSaleTax, type HomeSaleTaxItem } from "./homeSaleTax";
import {
  isCurrentPropertyAsset,
  latestOwnedPlannedPurchase,
  type PlannedPropertyPurchase,
  type RetirementCutoff,
  type RetirementCutoffProperty,
} from "./retirementCutoff";
import type { BasisPoints, Cents, FinancialSnapshot, HomeSaleAssumptions, Scenario } from "./types";

export interface RetirementSnapshotInput {
  cutoff: RetirementCutoff;
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  withdrawalRateBps: BasisPoints;
}

export interface RetirementMissingData {
  assetId: string;
  assetName: string;
  field: "purchaseDate" | "taxBasis" | "sellingCostBps" | "mortgageBalance" |
    "primaryResidenceEligibility" | "federalDepreciation" | "californiaDepreciation" | "rentalUse";
  message: string;
}

export type SellHomesResult =
  | { available: true; grossHomeEquityCents: Cents; sellingCostsCents: Cents; incrementalSaleTaxCents: Cents; netHomeProceedsCents: Cents; liquidNetWorthCents: Cents; annualPreTaxIncomeCents: Cents }
  | { available: false; issues: readonly RetirementMissingData[] };

export interface RetirementSnapshotResult {
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  netWorthCents: Cents;
  keepHomes: {
    homeEquityCents: Cents;
    nonHomeNetWorthCents: Cents;
    withdrawalIncomeCents: Cents;
    grossRentalIncomeCents: Cents;
    annualPreTaxIncomeCents: Cents;
  };
  sellHomes: SellHomesResult;
}

interface ResolvedHome {
  property: RetirementCutoffProperty;
  purchaseDate?: string | null;
  taxBasisCents?: Cents | null;
  assumptions?: HomeSaleAssumptions | null;
  liabilityId?: string;
  mortgageCents: Cents;
  use?: HomeSaleTaxItem["use"];
}

const issueMessage = (field: RetirementMissingData["field"], name: string) => {
  switch (field) {
    case "purchaseDate": return `Add a purchase date for ${name}.`;
    case "taxBasis": return `Add a tax basis for ${name}.`;
    case "sellingCostBps": return `Add selling costs for ${name}.`;
    case "mortgageBalance": return `Add the mortgage balance for ${name}.`;
    case "primaryResidenceEligibility": return `Confirm primary residence eligibility for ${name}.`;
    case "federalDepreciation": return `Add federal depreciation for ${name}.`;
    case "californiaDepreciation": return `Add California depreciation for ${name}.`;
    case "rentalUse": return `Review rental use for ${name}; mixed-use sale tax is not supported.`;
  }
};

const addIssue = (
  issues: RetirementMissingData[],
  property: RetirementCutoffProperty,
  field: RetirementMissingData["field"],
) => issues.push({
  assetId: property.assetId,
  assetName: property.name,
  field,
  message: issueMessage(field, property.name),
});

const hasOwn = (values: Readonly<Record<string, Cents>>, id: string) =>
  Object.prototype.hasOwnProperty.call(values, id);

const validatePropertyRows = (input: RetirementSnapshotInput) => {
  const counts = new Map<string, number>();
  for (const property of input.cutoff.properties) {
    const count = (counts.get(property.assetId) ?? 0) + 1;
    counts.set(property.assetId, count);
    if (count > 1) {
      throw new RangeError(`Retirement cutoff properties must contain one row for asset ${property.assetId}`);
    }
    if (!hasOwn(input.cutoff.assets, property.assetId)) {
      throw new RangeError(`Retirement cutoff property ${property.assetId} is missing from cutoff assets`);
    }
    if (input.cutoff.assets[property.assetId] !== property.valueCents) {
      throw new RangeError(`Retirement cutoff property ${property.assetId} value must match cutoff assets`);
    }
  }

  const plannedAssetIds = new Set(input.scenario.events.flatMap((event) =>
    event.type === "asset-purchase" ? [event.assetId] : []));
  const expectedPropertyIds = new Set([
    ...Object.keys(input.cutoff.assets).filter((assetId) => isCurrentPropertyAsset(
      input.snapshot,
      input.scenario,
      assetId,
      `${input.cutoff.retirementMonth}-01`,
    )),
    ...[...plannedAssetIds].filter((assetId) =>
      hasOwn(input.cutoff.assets, assetId) &&
      latestOwnedPlannedPurchase(input.scenario, assetId, `${input.cutoff.retirementMonth}-01`) != null),
  ]);
  for (const assetId of expectedPropertyIds) {
    if (!counts.has(assetId)) {
      throw new RangeError(`Retirement cutoff is missing a property row for ${assetId}`);
    }
  }
  for (const property of input.cutoff.properties) {
    if (!expectedPropertyIds.has(property.assetId)) {
      throw new RangeError(`Retirement cutoff property ${property.assetId} does not match an owned home asset`);
    }
  }
};

const currentHomeIsRental = (
  property: RetirementCutoffProperty,
  asset: FinancialSnapshot["assets"][number] | undefined,
) => property.monthlyGrossRentCents > 0 ||
  property.projectedDepreciationCents > 0 ||
  asset?.rentalTaxBasisCents != null ||
  asset?.rentalLandBasisCents != null ||
  asset?.rentalBuildingBasisCents != null ||
  asset?.rentalPlacedInServiceDate != null ||
  (asset?.homeSaleAssumptions?.accumulatedFederalDepreciationCents ?? 0) > 0 ||
  (asset?.homeSaleAssumptions?.accumulatedCaliforniaDepreciationCents ?? 0) > 0;

const plannedHomeIsRental = (
  property: RetirementCutoffProperty,
  purchase: PlannedPropertyPurchase | undefined,
) => {
  const details = purchase?.propertyDetails;
  return property.monthlyGrossRentCents > 0 ||
    property.projectedDepreciationCents > 0 ||
    (purchase?.monthlyRentalIncomeCents ?? 0) > 0 ||
    (details?.monthlyRentalIncomeCents ?? 0) > 0 ||
    (details?.rentalUseBps ?? 0) > 0 ||
    details?.rentalTaxModelingEnabled === true ||
    details?.propertyTaxBasisCents != null ||
    details?.buildingBasisCents != null ||
    (details?.homeSaleAssumptions?.accumulatedFederalDepreciationCents ?? 0) > 0 ||
    (details?.homeSaleAssumptions?.accumulatedCaliforniaDepreciationCents ?? 0) > 0;
};

const latestCurrentRentalStart = (
  input: RetirementSnapshotInput,
  property: RetirementCutoffProperty,
) => input.scenario.events
  .filter((event): event is Extract<Scenario["events"][number], { type: "property-rental-start" }> =>
    event.type === "property-rental-start" &&
    event.assetId === property.assetId &&
    event.date < `${input.cutoff.retirementMonth}-01`)
  .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
  .at(-1);

const resolveHomeUse = (
  input: RetirementSnapshotInput,
  property: RetirementCutoffProperty,
  current: FinancialSnapshot["assets"][number] | undefined,
  planned: PlannedPropertyPurchase | undefined,
): HomeSaleTaxItem["use"] | undefined => {
  const rentalEvidence = property.source === "current"
    ? currentHomeIsRental(property, current)
    : plannedHomeIsRental(property, planned);
  const explicitUseBps = property.rentalUseBps ?? (property.source === "current"
    ? latestCurrentRentalStart(input, property)?.rentalUseBps
    : planned?.propertyDetails?.rentalUseBps);
  const aduEvidence = (property.monthlyAduRentCents ?? 0) > 0 || input.scenario.events.some((event) =>
    event.type === "adu-build" &&
    event.assetId === property.assetId &&
    event.date < `${input.cutoff.retirementMonth}-01` &&
    (property.source === "current" || planned == null ||
      event.date > planned.date ||
      event.date === planned.date && event.id.localeCompare(planned.id) > 0) &&
    (event.monthlyRentalIncomeCents ?? 0) > 0);
  const plannedPrimaryWithRental = property.source === "planned" &&
    planned?.propertyDetails?.primaryResidence === true &&
    rentalEvidence;

  if (explicitUseBps === 10_000) return "rental";
  if (explicitUseBps != null && explicitUseBps > 0) return undefined;
  if (explicitUseBps === 0 && rentalEvidence) return undefined;
  if (aduEvidence || plannedPrimaryWithRental) return undefined;
  return rentalEvidence ? "rental" : "personal";
};

const resolveHomes = (input: RetirementSnapshotInput) => input.cutoff.properties.map((property): ResolvedHome => {
  const current = property.source === "current"
    ? input.snapshot.assets.find((asset) => asset.id === property.assetId)
    : undefined;
  const planned = property.source === "planned"
    ? latestOwnedPlannedPurchase(
      input.scenario,
      property.assetId,
      `${input.cutoff.retirementMonth}-01`,
    )
    : undefined;
  const metadataLiabilityId = property.source === "current"
    ? input.snapshot.liabilities.find((liability) => liability.mortgage?.assetId === property.assetId)?.id
    : planned?.financing?.liabilityId;
  const liabilityId = property.liabilityId ?? metadataLiabilityId;

  return {
    property,
    purchaseDate: property.source === "current" ? current?.purchaseDate : planned?.date,
    taxBasisCents: property.source === "current" ? current?.purchasePriceCents : planned?.valueCents,
    assumptions: property.source === "current"
      ? current?.homeSaleAssumptions
      : planned?.propertyDetails?.homeSaleAssumptions,
    liabilityId,
    mortgageCents: liabilityId && hasOwn(input.cutoff.liabilities, liabilityId)
      ? input.cutoff.liabilities[liabilityId]
      : property.mortgageCents,
    use: resolveHomeUse(input, property, current, planned),
  };
});

const validateWithdrawalRate = (withdrawalRateBps: BasisPoints) => {
  if (!Number.isInteger(withdrawalRateBps) || withdrawalRateBps < 1 || withdrawalRateBps > 10_000) {
    throw new RangeError("withdrawalRateBps must be an integer from 1 to 10000");
  }
};

export function calculateRetirementSnapshot(input: RetirementSnapshotInput): RetirementSnapshotResult {
  validateWithdrawalRate(input.withdrawalRateBps);
  validatePropertyRows(input);

  const accountTotal = Object.values(input.cutoff.accounts).reduce((sum, value) => sum + value, 0);
  const assetTotal = Object.values(input.cutoff.assets).reduce((sum, value) => sum + value, 0);
  const liabilityTotal = Object.values(input.cutoff.liabilities).reduce((sum, value) => sum + value, 0);
  const netWorthCents = accountTotal + assetTotal - liabilityTotal;
  const homes = resolveHomes(input);
  const homeEquityCents = homes.reduce(
    (sum, home) => sum + home.property.valueCents - home.mortgageCents,
    0,
  );
  const nonHomeNetWorthCents = netWorthCents - homeEquityCents;
  const withdrawalIncomeCents = Math.round(
    Math.max(0, nonHomeNetWorthCents) * input.withdrawalRateBps / 10_000,
  );
  const grossRentalIncomeCents = homes.reduce(
    (sum, home) => sum + home.property.monthlyGrossRentCents * 12,
    0,
  );
  const keepHomes = {
    homeEquityCents,
    nonHomeNetWorthCents,
    withdrawalIncomeCents,
    grossRentalIncomeCents,
    annualPreTaxIncomeCents: withdrawalIncomeCents + grossRentalIncomeCents,
  };

  const issues: RetirementMissingData[] = [];
  for (const home of homes) {
    const { property, assumptions } = home;
    if (!home.purchaseDate) addIssue(issues, property, "purchaseDate");
    if (home.taxBasisCents == null) addIssue(issues, property, "taxBasis");
    if (assumptions?.sellingCostBps == null) addIssue(issues, property, "sellingCostBps");

    const metadataLiabilityIds = property.source === "current"
      ? input.snapshot.liabilities
        .filter((liability) => liability.mortgage?.assetId === property.assetId)
        .map((liability) => liability.id)
      : (() => {
        const purchase = latestOwnedPlannedPurchase(
          input.scenario,
          property.assetId,
          `${input.cutoff.retirementMonth}-01`,
        );
        return purchase?.financing ? [purchase.financing.liabilityId] : [];
      })();
    const linkedLiabilityIds = new Set([
      ...(property.liabilityId ? [property.liabilityId] : []),
      ...metadataLiabilityIds,
    ]);
    const mortgageReconciles = linkedLiabilityIds.size === 0
      ? property.mortgageCents === 0
      : linkedLiabilityIds.size === 1 &&
        home.liabilityId != null &&
        hasOwn(input.cutoff.liabilities, home.liabilityId) &&
        input.cutoff.liabilities[home.liabilityId] === property.mortgageCents;
    if (!mortgageReconciles) addIssue(issues, property, "mortgageBalance");

    if (home.use == null) addIssue(issues, property, "rentalUse");

    if (typeof assumptions?.primaryResidenceExclusionEligible !== "boolean") {
      addIssue(issues, property, "primaryResidenceEligibility");
    }
    if (assumptions?.accumulatedFederalDepreciationCents == null) {
      addIssue(issues, property, "federalDepreciation");
    }
    if (assumptions?.accumulatedCaliforniaDepreciationCents == null) {
      addIssue(issues, property, "californiaDepreciation");
    }
  }

  if (issues.length > 0) {
    return {
      retirementMonth: input.cutoff.retirementMonth,
      withdrawalRateBps: input.withdrawalRateBps,
      netWorthCents,
      keepHomes,
      sellHomes: { available: false, issues },
    };
  }

  const sales: HomeSaleTaxItem[] = homes.map((home) => {
    const assumptions = home.assumptions!;
    return {
      id: home.property.assetId,
      name: home.property.name,
      use: home.use!,
      acquiredOn: home.purchaseDate!,
      disposedOn: `${input.cutoff.retirementMonth}-01`,
      salePriceCents: home.property.valueCents,
      sellingCostCents: Math.round(home.property.valueCents * assumptions.sellingCostBps / 10_000),
      federalBasisCents: home.taxBasisCents!,
      californiaBasisCents: home.taxBasisCents!,
      accumulatedFederalDepreciationCents:
        assumptions.accumulatedFederalDepreciationCents + home.property.projectedDepreciationCents,
      accumulatedCaliforniaDepreciationCents:
        assumptions.accumulatedCaliforniaDepreciationCents + home.property.projectedDepreciationCents,
      primaryResidenceExclusionEligible: assumptions.primaryResidenceExclusionEligible,
    };
  });
  const tax = calculateIncrementalHomeSaleTax({
    year: Number(input.cutoff.retirementMonth.slice(0, 4)),
    filingStatus: input.snapshot.taxProfile.filingStatus,
    thresholdInflationBps: input.scenario.assumptions.thresholdInflationBps,
    baseline: input.cutoff.taxLedger,
    sales,
  });
  const sellingCostsCents = sales.reduce((sum, sale) => sum + sale.sellingCostCents, 0);
  const grossHomeEquityCents = homeEquityCents;
  const incrementalSaleTaxCents = tax.totalIncrementalTaxCents;
  const netHomeProceedsCents = grossHomeEquityCents - sellingCostsCents - incrementalSaleTaxCents;
  const liquidNetWorthCents = nonHomeNetWorthCents + netHomeProceedsCents;
  const annualPreTaxIncomeCents = Math.round(
    Math.max(0, liquidNetWorthCents) * input.withdrawalRateBps / 10_000,
  );

  return {
    retirementMonth: input.cutoff.retirementMonth,
    withdrawalRateBps: input.withdrawalRateBps,
    netWorthCents,
    keepHomes,
    sellHomes: {
      available: true,
      grossHomeEquityCents,
      sellingCostsCents,
      incrementalSaleTaxCents,
      netHomeProceedsCents,
      liquidNetWorthCents,
      annualPreTaxIncomeCents,
    },
  };
}
