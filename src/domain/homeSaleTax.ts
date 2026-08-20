import { progressiveTax, projectedTaxRules } from "./tax";
import type { BasisPoints, Cents, FilingStatus, TaxLedger } from "./types";

export interface HomeSaleTaxItem {
  id: string;
  name: string;
  acquiredOn: string;
  disposedOn: string;
  salePriceCents: Cents;
  sellingCostCents: Cents;
  federalBasisCents: Cents;
  californiaBasisCents: Cents;
  accumulatedFederalDepreciationCents: Cents;
  accumulatedCaliforniaDepreciationCents: Cents;
  primaryResidenceExclusionEligible: boolean;
}

export interface HomeSaleTaxInput {
  year: number;
  filingStatus: FilingStatus;
  thresholdInflationBps: BasisPoints;
  baseline: Pick<TaxLedger, "federalTaxableCents" | "californiaTaxableCents" | "modifiedAgiCents">;
  sales: readonly HomeSaleTaxItem[];
}

export interface HomeSaleTaxResult {
  sales: readonly {
    id: string;
    netSalePriceCents: Cents;
    federalGainCents: Cents;
    californiaGainCents: Cents;
    exclusionCents: Cents;
  }[];
  federalShortTermGainCents: Cents;
  federalLongTermGainCents: Cents;
  unrecaptured1250GainCents: Cents;
  californiaGainCents: Cents;
  federalIncomeTaxCents: Cents;
  californiaIncomeTaxCents: Cents;
  niitCents: Cents;
  totalIncrementalTaxCents: Cents;
}

const isShortTerm = (acquiredOn: string, disposedOn: string) => {
  const anniversary = new Date(`${acquiredOn}T00:00:00Z`);
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  return Date.parse(`${disposedOn}T00:00:00Z`) <= anniversary.getTime();
};

const netByHoldingPeriod = (short: number, long: number) => {
  if (short < 0 && long > 0) {
    const offset = Math.min(-short, long);
    short += offset;
    long -= offset;
  } else if (long < 0 && short > 0) {
    const offset = Math.min(-long, short);
    long += offset;
    short -= offset;
  }
  return { short: Math.max(0, short), long: Math.max(0, long) };
};

export function calculateIncrementalHomeSaleTax(input: HomeSaleTaxInput): HomeSaleTaxResult {
  const pack = projectedTaxRules(input.year, input.thresholdInflationBps);
  const exclusionLimitCents = input.filingStatus === "married-joint" ? 500_000_00 : 250_000_00;
  let federalShort = 0;
  let federalLong = 0;
  let federalRecapture = 0;
  let californiaGain = 0;

  const sales = input.sales.map((sale) => {
    const netSalePriceCents = Math.round(sale.salePriceCents - sale.sellingCostCents);
    const federalRawGain = Math.round(
      netSalePriceCents - sale.federalBasisCents + sale.accumulatedFederalDepreciationCents,
    );
    const californiaRawGain = Math.round(
      netSalePriceCents - sale.californiaBasisCents + sale.accumulatedCaliforniaDepreciationCents,
    );
    const federalRecaptureForSale = Math.min(
      sale.accumulatedFederalDepreciationCents,
      Math.max(0, federalRawGain),
    );
    const californiaRecaptureForSale = Math.min(
      sale.accumulatedCaliforniaDepreciationCents,
      Math.max(0, californiaRawGain),
    );
    const exclusionCents = sale.primaryResidenceExclusionEligible
      ? Math.min(exclusionLimitCents, Math.max(0, federalRawGain - federalRecaptureForSale))
      : 0;
    const californiaExclusionCents = sale.primaryResidenceExclusionEligible
      ? Math.min(exclusionLimitCents, Math.max(0, californiaRawGain - californiaRecaptureForSale))
      : 0;
    const federalGainCents = sale.primaryResidenceExclusionEligible
      ? Math.max(0, federalRawGain - exclusionCents)
      : federalRawGain;
    const californiaGainCents = sale.primaryResidenceExclusionEligible
      ? Math.max(0, californiaRawGain - californiaExclusionCents)
      : californiaRawGain;
    const shortTerm = isShortTerm(sale.acquiredOn, sale.disposedOn);

    if (shortTerm) federalShort += federalGainCents;
    else {
      federalLong += federalGainCents;
      federalRecapture += Math.min(federalRecaptureForSale, Math.max(0, federalGainCents));
    }
    californiaGain += californiaGainCents;

    return { id: sale.id, netSalePriceCents, federalGainCents, californiaGainCents, exclusionCents };
  });

  const netFederal = netByHoldingPeriod(federalShort, federalLong);
  const federalShortTermGainCents = Math.round(netFederal.short);
  const federalLongTermGainCents = Math.round(netFederal.long);
  const unrecaptured1250GainCents = Math.round(Math.min(federalRecapture, federalLongTermGainCents));
  const californiaGainCents = Math.round(Math.max(0, californiaGain));
  const federalBase = Math.max(0, input.baseline.federalTaxableCents);
  const federalOrdinaryAfterSales = federalBase + federalShortTermGainCents;
  const federalOrdinaryDelta = progressiveTax(
    federalOrdinaryAfterSales,
    pack.federal[input.filingStatus].brackets,
  ) - progressiveTax(federalBase, pack.federal[input.filingStatus].brackets);
  const capitalGainBrackets = pack.federalLongTermCapitalGains[input.filingStatus];
  const federalPreferentialDelta = progressiveTax(
    federalOrdinaryAfterSales + federalLongTermGainCents,
    capitalGainBrackets,
  ) - progressiveTax(federalOrdinaryAfterSales, capitalGainBrackets);
  const preferentialRecaptureTax = progressiveTax(
    federalOrdinaryAfterSales + unrecaptured1250GainCents,
    capitalGainBrackets,
  ) - progressiveTax(federalOrdinaryAfterSales, capitalGainBrackets);
  const recaptureTaxAtMaximumRate = Math.round(
    unrecaptured1250GainCents * pack.unrecapturedSection1250MaxRateBps / 10_000,
  );
  const federalIncomeTaxCents = Math.round(
    federalOrdinaryDelta
      + federalPreferentialDelta
      + Math.max(0, recaptureTaxAtMaximumRate - preferentialRecaptureTax),
  );
  const californiaBase = Math.max(0, input.baseline.californiaTaxableCents);
  const californiaIncomeTaxCents = Math.round(
    progressiveTax(
      californiaBase + californiaGainCents,
      pack.california[input.filingStatus].brackets,
    ) - progressiveTax(californiaBase, pack.california[input.filingStatus].brackets),
  );
  const investmentGainCents = federalShortTermGainCents + federalLongTermGainCents;
  const niitBaseCents = Math.min(
    investmentGainCents,
    Math.max(
      0,
      input.baseline.modifiedAgiCents
        + investmentGainCents
        - pack.netInvestmentIncomeThresholdCents[input.filingStatus],
    ),
  );
  const niitCents = Math.round(niitBaseCents * 380 / 10_000);
  const totalIncrementalTaxCents = Math.max(
    0,
    Math.round(federalIncomeTaxCents + californiaIncomeTaxCents + niitCents),
  );

  return {
    sales,
    federalShortTermGainCents,
    federalLongTermGainCents,
    unrecaptured1250GainCents,
    californiaGainCents,
    federalIncomeTaxCents,
    californiaIncomeTaxCents,
    niitCents,
    totalIncrementalTaxCents,
  };
}
