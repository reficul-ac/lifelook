import { progressiveTax, projectedTaxRules } from "./tax";
import type { BasisPoints, Cents, FilingStatus, TaxLedger } from "./types";

export interface HomeSaleTaxItem {
  id: string;
  name: string;
  use: "personal" | "rental";
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

const assertCents = (name: string, value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer number of cents`);
  }
};

const parseDate = (name: string, value: string) => {
  if (typeof value !== "string") throw new TypeError(`${name} must be a canonical YYYY-MM-DD calendar date`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`${name} must be a canonical YYYY-MM-DD calendar date`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || daysInMonth === undefined || day < 1 || day > daysInMonth) {
    throw new RangeError(`${name} must be a canonical YYYY-MM-DD calendar date`);
  }
  return { year, month, day, key: year * 10_000 + month * 100 + day };
};

const validateInput = (input: HomeSaleTaxInput) => {
  assertCents("baseline.federalTaxableCents", input.baseline.federalTaxableCents);
  assertCents("baseline.californiaTaxableCents", input.baseline.californiaTaxableCents);
  assertCents("baseline.modifiedAgiCents", input.baseline.modifiedAgiCents);

  for (const sale of input.sales) {
    assertCents("salePriceCents", sale.salePriceCents);
    assertCents("sellingCostCents", sale.sellingCostCents);
    assertCents("federalBasisCents", sale.federalBasisCents);
    assertCents("californiaBasisCents", sale.californiaBasisCents);
    assertCents("accumulatedFederalDepreciationCents", sale.accumulatedFederalDepreciationCents);
    assertCents("accumulatedCaliforniaDepreciationCents", sale.accumulatedCaliforniaDepreciationCents);
    if (sale.sellingCostCents > sale.salePriceCents) {
      throw new RangeError("sellingCostCents cannot exceed salePriceCents");
    }
    if (sale.accumulatedFederalDepreciationCents > sale.federalBasisCents) {
      throw new RangeError("accumulatedFederalDepreciationCents cannot exceed federalBasisCents");
    }
    if (sale.accumulatedCaliforniaDepreciationCents > sale.californiaBasisCents) {
      throw new RangeError("accumulatedCaliforniaDepreciationCents cannot exceed californiaBasisCents");
    }
    const acquired = parseDate("acquiredOn", sale.acquiredOn);
    const disposed = parseDate("disposedOn", sale.disposedOn);
    if (disposed.key < acquired.key) throw new RangeError("disposedOn cannot be before acquiredOn");
    if (disposed.year !== input.year) {
      throw new RangeError(`disposedOn year ${disposed.year} must match calculation year ${input.year}`);
    }
  }
};

const isShortTerm = (acquiredOn: string, disposedOn: string) => {
  const acquired = parseDate("acquiredOn", acquiredOn);
  const disposed = parseDate("disposedOn", disposedOn);
  const anniversaryKey = (acquired.year + 1) * 10_000 + acquired.month * 100 + acquired.day;
  return disposed.key <= anniversaryKey;
};

const netByHoldingPeriod = (short: number, long: number) => {
  let shortLossAppliedToLong = 0;
  if (short < 0 && long > 0) {
    const offset = Math.min(-short, long);
    shortLossAppliedToLong = offset;
    short += offset;
    long -= offset;
  } else if (long < 0 && short > 0) {
    const offset = Math.min(-long, short);
    long += offset;
    short -= offset;
  }
  return { short: Math.max(0, short), long: Math.max(0, long), shortLossAppliedToLong };
};

export function calculateIncrementalHomeSaleTax(input: HomeSaleTaxInput): HomeSaleTaxResult {
  validateInput(input);
  const pack = projectedTaxRules(input.year, input.thresholdInflationBps);
  const exclusionLimitCents = input.filingStatus === "married-joint" ? 500_000_00 : 250_000_00;
  let remainingFederalExclusionCents = exclusionLimitCents;
  let remainingCaliforniaExclusionCents = exclusionLimitCents;
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
      ? Math.min(remainingFederalExclusionCents, Math.max(0, federalRawGain - federalRecaptureForSale))
      : 0;
    const californiaExclusionCents = sale.primaryResidenceExclusionEligible
      ? Math.min(remainingCaliforniaExclusionCents, Math.max(0, californiaRawGain - californiaRecaptureForSale))
      : 0;
    remainingFederalExclusionCents -= exclusionCents;
    remainingCaliforniaExclusionCents -= californiaExclusionCents;
    const federalGainAfterExclusion = federalRawGain - exclusionCents;
    const californiaGainAfterExclusion = californiaRawGain - californiaExclusionCents;
    const federalGainCents = sale.use === "personal"
      ? Math.max(0, federalGainAfterExclusion)
      : federalGainAfterExclusion;
    const californiaGainCents = sale.use === "personal"
      ? Math.max(0, californiaGainAfterExclusion)
      : californiaGainAfterExclusion;
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
  const unrecaptured1250GainCents = Math.round(Math.min(
    Math.max(0, federalRecapture - netFederal.shortLossAppliedToLong),
    federalLongTermGainCents,
  ));
  const californiaGainCents = Math.round(Math.max(0, californiaGain));
  const federalBase = Math.max(0, input.baseline.federalTaxableCents);
  const federalOrdinaryAfterSales = federalBase + federalShortTermGainCents;
  const federalOrdinaryDelta = progressiveTax(
    federalOrdinaryAfterSales,
    pack.federal[input.filingStatus].brackets,
  ) - progressiveTax(federalBase, pack.federal[input.filingStatus].brackets);
  const federalAfterRecapture = federalOrdinaryAfterSales + unrecaptured1250GainCents;
  const recaptureOrdinaryDelta = progressiveTax(
    federalAfterRecapture,
    pack.federal[input.filingStatus].brackets,
  ) - progressiveTax(federalOrdinaryAfterSales, pack.federal[input.filingStatus].brackets);
  const recaptureTaxAtMaximumRate = Math.round(
    unrecaptured1250GainCents * pack.unrecapturedSection1250MaxRateBps / 10_000,
  );
  const federalRecaptureTax = Math.min(recaptureOrdinaryDelta, recaptureTaxAtMaximumRate);
  const federalPreferentialGainCents = federalLongTermGainCents - unrecaptured1250GainCents;
  const capitalGainBrackets = pack.federalLongTermCapitalGains[input.filingStatus];
  const federalPreferentialDelta = progressiveTax(
    federalAfterRecapture + federalPreferentialGainCents,
    capitalGainBrackets,
  ) - progressiveTax(federalAfterRecapture, capitalGainBrackets);
  const federalIncomeTaxCents = Math.round(
    federalOrdinaryDelta
      + federalPreferentialDelta
      + federalRecaptureTax,
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
