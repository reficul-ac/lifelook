import { calculateRetirementPlan, projectGrowth, ProjectionEngine } from "./projection";
import { buildRetirementCutoff } from "./retirementCutoff";
import { calculateIncrementalHouseholdIncomeTax } from "./tax";
import { calculateIncrementalHomeSaleTax, type HomeSaleTaxItem } from "./homeSaleTax";
import { projectedSharePrice, valueForUnits } from "./equity";
import {
  calculateRetirementKeepSnapshot,
  calculateRetirementSnapshot,
  resolveRetirementHomeSales,
  type RetirementMissingData,
  type RetirementKeepSnapshotResult,
  type RetirementSnapshotResult,
  type ResolvedRetirementHomeSales,
  type SellHomesResult,
} from "./retirementSnapshot";
import {
  isTaxableInvestmentAccount,
  type NormalizedRetirementSettings,
} from "./retirementSettings";
import {
  ageOnDate,
  drawRetirementFunds,
  isRetirementDrawableAccount,
  resolveRetirementAccountOrder,
  type RetirementDrawSource,
} from "./retirementWithdrawals";
import type { BasisPoints, Cents, FinancialSnapshot, Scenario, TaxLedger, TaxLotRecord } from "./types";

export interface RetirementProjectionInput {
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  asOfDate: string;
  settings: NormalizedRetirementSettings;
}

export interface RetirementProjectionWarning {
  code: "missing-destination" | "missing-home-data" | "early-withdrawal" |
    "account-depleted" | "unfunded-spending" | "activity-ended" | "calculation-error" |
    "unsupported-tax-character" | "unsupported-rental-tax" |
    "conservative-taxable-basis";
  year?: number;
  entityId?: string;
  message: string;
}

export interface RetirementProjectionYear {
  year: number;
  ages: readonly { personId: string; name: string; age: number | null }[];
  startingPortfolioCents: Cents;
  withdrawalTargetCents: Cents;
  withdrawalFundedCents: Cents;
  otherPreTaxIncomeCents: Cents;
  rentalIncomeCents: Cents;
  estimatedTaxCents: Cents;
  totalTaxCents: Cents;
  typicalYearTaxCents: Cents;
  earlyPenaltyCents: Cents;
  afterTaxIncomeCents: Cents;
  typicalAfterTaxIncomeCents: Cents;
  planExpenseCents: Cents;
  housingExpenseCents: Cents;
  surplusCents: Cents;
  shortfallCents: Cents;
  destinationBalanceCents: Cents;
  endingLiquidAccountsCents: Cents;
  endingRetirementAccountsCents: Cents;
  endingHomeEquityCents: Cents;
  endingDebtCents: Cents;
  endingOtherNetWorthCents: Cents;
  endingNetWorthCents: Cents;
  taxBreakdown: {
    ordinaryDistributionsCents: Cents;
    shortTermGainsCents: Cents;
    longTermGainsCents: Cents;
    grossRentalIncomeCents: Cents;
    federalTaxableRentalIncomeCents: Cents;
    californiaTaxableRentalIncomeCents: Cents;
    federalRentalDeductionsCents: Cents;
    californiaRentalDeductionsCents: Cents;
    federalDeductionCents: Cents;
    californiaDeductionCents: Cents;
    federalTaxableIncomeCents: Cents;
    californiaTaxableIncomeCents: Cents;
    federalIncomeTaxCents: Cents;
    californiaIncomeTaxCents: Cents;
    netInvestmentIncomeTaxCents: Cents;
    homeSaleTaxCents: Cents;
  };
  privateStockSale?: {
    grossProceedsCents: Cents;
    taxableGainCents: Cents;
    estimatedTaxCents: Cents;
    netProceedsCents: Cents;
  };
  endingBalances: {
    accounts: Readonly<Record<string, Cents>>;
    assets: Readonly<Record<string, Cents>>;
    liabilities: Readonly<Record<string, Cents>>;
  };
  housing: {
    principalCents: Cents;
    interestCents: Cents;
    propertyTaxCents: Cents;
    insuranceCents: Cents;
    hoaCents: Cents;
    maintenanceCents: Cents;
  };
  homeSale?: {
    grossSaleValueCents: Cents;
    sellingCostsCents: Cents;
    mortgagePayoffCents: Cents;
    incrementalSaleTaxCents: Cents;
    netProceedsCents: Cents;
  };
  withdrawalSources: readonly RetirementDrawSource[];
  warnings: readonly RetirementProjectionWarning[];
}

export interface AvailableRetirementScenarioProjection<TSummary> {
  available: true;
  summary: TSummary;
  years: readonly RetirementProjectionYear[];
  warnings: readonly RetirementProjectionWarning[];
}

export interface UnavailableRetirementScenarioProjection {
  available: false;
  issues: readonly RetirementMissingData[];
  warnings: readonly RetirementProjectionWarning[];
  years: readonly [];
}

export interface RetirementProjectionResult {
  retirementMonth: string;
  firstWithdrawalDate: string;
  withdrawalRateBps: BasisPoints;
  netWorthCents: Cents | null;
  keepHomes: AvailableRetirementScenarioProjection<RetirementSnapshotResult["keepHomes"]> |
    UnavailableRetirementScenarioProjection;
  sellHomes: AvailableRetirementScenarioProjection<Extract<SellHomesResult, { available: true }>> |
    UnavailableRetirementScenarioProjection;
  effectiveWithdrawalOrder: readonly string[];
  resolvedHomeSales: ResolvedRetirementHomeSales | null;
  warnings: readonly RetirementProjectionWarning[];
}

const parseMonth = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (match == null || month < 1 || month > 12) throw new RangeError(`Invalid month: ${value}`);
  return { year, month };
};

const addMonths = (month: string, count: number) => {
  const parsed = parseMonth(month);
  const monthIndex = parsed.year * 12 + parsed.month - 1 + count;
  return `${Math.floor(monthIndex / 12)}-${String(monthIndex % 12 + 1).padStart(2, "0")}`;
};

const monthEndDate = (month: string) => {
  const nextMonth = addMonths(month, 1);
  const { year, month: monthNumber } = parseMonth(nextMonth);
  return new Date(Date.UTC(year, monthNumber - 1, 0)).toISOString().slice(0, 10);
};

const monthsInclusive = (start: string, end: string) => {
  const from = parseMonth(start);
  const to = parseMonth(end);
  return (to.year - from.year) * 12 + to.month - from.month + 1;
};

export const extendScenarioHorizon = (
  scenario: Scenario,
  retirementMonth: string,
  horizonYears: number,
  projectionStartMonth: string = scenario.horizon.start,
): Scenario => {
  if (!Number.isInteger(horizonYears) || horizonYears < 1 || horizonYears > 60) {
    throw new RangeError("horizonYears must be an integer from 1 to 60");
  }
  const finalRetirementMonth = addMonths(retirementMonth, horizonYears * 12 - 1);
  const months = monthsInclusive(projectionStartMonth, finalRetirementMonth);
  if (months < 1) throw new RangeError("Retirement horizon cannot end before the scenario starts");
  return {
    ...scenario,
    horizon: { start: projectionStartMonth, months },
  };
};

interface RetirementYearState {
  accounts: Record<string, Cents>;
  assets: Record<string, Cents>;
  liabilities: Record<string, Cents>;
  taxableBasis: Record<string, Cents>;
  taxableLots: Record<string, TaxLotRecord[]>;
  unsupportedTaxCharacter?: Record<string, true>;
  rothContributionBasis: Record<string, Cents>;
}

interface RetirementHomeSaleRollForward {
  assetIds: readonly string[];
  liabilityIds: readonly string[];
  grossSaleValueCents: Cents;
  sellingCostsCents: Cents;
  mortgagePayoffCents: Cents;
  incrementalSaleTaxCents: Cents;
  netProceedsCents: Cents;
  sales: readonly HomeSaleTaxItem[];
}

const sumRecord = (values: Readonly<Record<string, Cents>>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0);

const portfolioValue = (
  state: RetirementYearState,
  accounts: readonly FinancialSnapshot["accounts"][number][],
) => accounts.reduce((sum, account) => isRetirementDrawableAccount(account)
  ? sum + Math.max(0, state.accounts[account.id] ?? 0)
  : sum, 0);

const calculateIncomeTax = (
  input: RetirementProjectionInput,
  periodStart: string,
  periodMonths: ReturnType<typeof ProjectionEngine.calculate>[number]["months"],
  taxLedgers: ReadonlyMap<number, TaxLedger>,
  sources: readonly RetirementDrawSource[],
  homeSale?: RetirementHomeSaleRollForward,
) => {
  let retirementTaxCents=0;
  let saleTaxCents=0;
  const breakdown={ordinaryDistributionsCents:0,shortTermGainsCents:0,longTermGainsCents:0,
    grossRentalIncomeCents:0,federalTaxableRentalIncomeCents:0,californiaTaxableRentalIncomeCents:0,
    federalRentalDeductionsCents:0,californiaRentalDeductionsCents:0,federalDeductionCents:0,
    californiaDeductionCents:0,federalTaxableIncomeCents:0,californiaTaxableIncomeCents:0,
    federalIncomeTaxCents:0,californiaIncomeTaxCents:0,netInvestmentIncomeTaxCents:0,homeSaleTaxCents:0};
  const startYear=Number(periodStart.slice(0,4));
  for(const calendarYear of [...new Set(periodMonths.map((month)=>Number(month.month.slice(0,4))))]){
    const baseline=taxLedgers.get(calendarYear);
    if(baseline==null)throw new RangeError(`Missing tax ledger for ${calendarYear}.`);
    const months=periodMonths.filter((month)=>Number(month.month.slice(0,4))===calendarYear);
    const includedProperties=months.flatMap((month)=>month.properties.filter((property)=>
      !(homeSale?.assetIds.includes(property.assetId)??false)));
    const taxableNonWage=months.reduce((sum,month)=>sum+month.taxableNonWageIncomeCents,0);
    const federalRental= includedProperties.reduce((sum,property)=>sum+property.federalAllowedRentalCents,0);
    const californiaRental=includedProperties.reduce((sum,property)=>sum+property.californiaAllowedRentalCents,0);
    const grossRental=includedProperties.reduce((sum,property)=>sum+property.rentCents+property.aduIncomeCents,0);
    const calendarSources=sources.filter((source)=>source.taxYear===calendarYear);
    const federalShort=sumSources(calendarSources,"federalShortTermGainCents");
    const federalLong=sumSources(calendarSources,"federalLongTermGainCents");
    const californiaGain=sumSources(calendarSources,"californiaGainCents");
    const distributionOrdinary=sumSources(calendarSources,"ordinaryIncomeCents")+sumSources(calendarSources,"rothTaxableCents");
    const personalMortgageDebtByAsset=new Map<string,Cents>();
    const personalHousing=months.reduce((total,month)=>{
      const rows=homeSale==null?undefined:month.properties.filter((property)=>!homeSale.assetIds.includes(property.assetId));
      const housing=rows==null?month.housing:{
        principalCents:rows.reduce((sum,row)=>sum+row.principalCents,0),
        interestCents:rows.reduce((sum,row)=>sum+row.interestCents,0),
        propertyTaxCents:rows.reduce((sum,row)=>sum+row.propertyTaxCents,0),
        insuranceCents:rows.reduce((sum,row)=>sum+row.insuranceCents,0),
        hoaCents:rows.reduce((sum,row)=>sum+row.hoaCents,0),
        maintenanceCents:rows.reduce((sum,row)=>sum+row.maintenanceCents,0),
      };
      const includedRows=month.properties.filter((property)=>!(homeSale?.assetIds.includes(property.assetId)??false));
      const rentalInterest=includedRows.reduce((sum,property)=>sum+Math.round(property.interestCents*property.rentalUseBps/10_000),0);
      const rentalPropertyTax=includedRows.reduce((sum,property)=>sum+Math.round(property.propertyTaxCents*property.rentalUseBps/10_000),0);
      total.mortgageInterestCents+=Math.max(0,housing.interestCents-rentalInterest);
      total.propertyTaxCents+=Math.max(0,housing.propertyTaxCents-rentalPropertyTax);
      for(const property of includedRows)personalMortgageDebtByAsset.set(property.assetId,Math.max(
        personalMortgageDebtByAsset.get(property.assetId)??0,
        Math.round(property.mortgageDebtCents*(10_000-property.rentalUseBps)/10_000),
      ));
      return total;
    },{mortgageInterestCents:0,propertyTaxCents:0});
    const incremental=calculateIncrementalHouseholdIncomeTax({
      year:calendarYear,
      status:input.snapshot.taxProfile.filingStatus,
      thresholdInflationBps:input.scenario.assumptions.thresholdInflationBps,
      baseline,
      federalOrdinaryIncomeCents:taxableNonWage+federalRental+distributionOrdinary,
      californiaOrdinaryIncomeCents:taxableNonWage+californiaRental+distributionOrdinary,
      federalShortTermGainCents:federalShort,
      federalLongTermGainCents:federalLong,
      californiaCapitalGainCents:californiaGain,
      federalInvestmentIncomeCents:Math.max(0,federalRental)+Math.max(0,federalShort+federalLong),
      personalHousing:{...personalHousing,mortgageDebtCents:[...personalMortgageDebtByAsset.values()].reduce((sum,value)=>sum+value,0)},
    });
    retirementTaxCents+=incremental.totalIncrementalTaxCents;
    breakdown.ordinaryDistributionsCents+=distributionOrdinary;
    breakdown.shortTermGainsCents+=federalShort;
    breakdown.longTermGainsCents+=federalLong;
    breakdown.grossRentalIncomeCents+=grossRental;
    breakdown.federalTaxableRentalIncomeCents+=federalRental;
    breakdown.californiaTaxableRentalIncomeCents+=californiaRental;
    breakdown.federalRentalDeductionsCents+=grossRental-federalRental;
    breakdown.californiaRentalDeductionsCents+=grossRental-californiaRental;
    breakdown.federalDeductionCents+=incremental.federalDeductionCents;
    breakdown.californiaDeductionCents+=incremental.californiaDeductionCents;
    breakdown.federalTaxableIncomeCents+=incremental.federalTaxableCents;
    breakdown.californiaTaxableIncomeCents+=incremental.californiaTaxableCents;
    breakdown.federalIncomeTaxCents+=incremental.federalIncomeTaxCents;
    breakdown.californiaIncomeTaxCents+=incremental.californiaIncomeTaxCents;
    breakdown.netInvestmentIncomeTaxCents+=incremental.niitCents;
    if(calendarYear===startYear&&homeSale?.sales.length){
      saleTaxCents=calculateIncrementalHomeSaleTax({
        year:calendarYear,
        filingStatus:input.snapshot.taxProfile.filingStatus,
        thresholdInflationBps:input.scenario.assumptions.thresholdInflationBps,
        baseline:{federalTaxableCents:incremental.federalTaxableCents,californiaTaxableCents:incremental.californiaTaxableCents,modifiedAgiCents:incremental.modifiedAgiCents},
        sales:homeSale.sales,
      }).totalIncrementalTaxCents;
      breakdown.homeSaleTaxCents=saleTaxCents;
    }
  }
  return {retirementTaxCents,saleTaxCents,breakdown};
};

const initialState = (
  input: RetirementProjectionInput,
  cutoff: ReturnType<typeof buildRetirementCutoff>,
): RetirementYearState => {
  const taxableBasis: Record<string, Cents> = {};
  const taxableLots: Record<string, TaxLotRecord[]> = {};
  const unsupportedTaxCharacter: Record<string, true> = {};
  const rothContributionBasis: Record<string, Cents> = {};
  const cutoffGrowthMonths = monthsInclusive(input.asOfDate.slice(0, 7), cutoff.balanceMonth);
  const canonicalDate = (value: string | null | undefined) => {
    if (value == null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };
  for (const account of input.snapshot.accounts) {
    const balance = Math.max(0, cutoff.accounts[account.id] ?? 0);
    if (account.subtype === "taxable-brokerage" ||
      account.subtype == null && account.kind === "investment") {
      const lotBasis = account.taxLots?.reduce((sum, lot) => sum + lot.federalBasisCents, 0);
      const recordedBasis = account.taxableCostBasisCents ?? lotBasis;
      taxableBasis[account.id] = Math.max(0, recordedBasis ?? 0);
      if (account.taxLots?.length) {
        const marketTotal = account.taxLots.reduce((sum, lot) => sum + lot.marketValueCents, 0);
        const federalBasisTotal = account.taxLots.reduce((sum, lot) => sum + lot.federalBasisCents, 0);
        let growthOnlyBalance = account.balanceCents;
        for (let month = 0; month < cutoffGrowthMonths; month++) {
          growthOnlyBalance = projectGrowth(growthOnlyBalance, account.annualReturnBps, 1);
        }
        const ids = new Set(account.taxLots.map((lot) => lot.id));
        const validLots = ids.size === account.taxLots.length && account.taxLots.every((lot) =>
          canonicalDate(lot.acquiredOn) &&
          Number.isSafeInteger(lot.marketValueCents) && lot.marketValueCents >= 0 &&
          Number.isSafeInteger(lot.federalBasisCents) && lot.federalBasisCents >= 0 &&
          Number.isSafeInteger(lot.californiaBasisCents) && lot.californiaBasisCents >= 0) &&
          marketTotal === account.balanceCents &&
          (account.taxableCostBasisCents == null || account.taxableCostBasisCents === federalBasisTotal) &&
          !(cutoff.accountProvenanceChangedIds?.includes(account.id) ?? false) &&
          growthOnlyBalance === balance;
        if (validLots && marketTotal > 0) {
          let allocated = 0;
          taxableLots[account.id] = account.taxLots.map((lot, index) => {
            const marketValueCents = index === account.taxLots!.length - 1
              ? balance - allocated
              : Math.round(balance * lot.marketValueCents / marketTotal);
            allocated += marketValueCents;
            return { ...lot, marketValueCents };
          });
          taxableBasis[account.id] = taxableLots[account.id]
            .reduce((sum, lot) => sum + lot.federalBasisCents, 0);
        } else {
          unsupportedTaxCharacter[account.id] = true;
        }
      } else if (balance === 0 && recordedBasis === 0) {
        taxableLots[account.id] = [];
      } else if (recordedBasis == null) {
        unsupportedTaxCharacter[account.id] = true;
      }
    }
    if (account.subtype === "roth-ira" || account.subtype === "employer-roth") {
      if (account.rothContributionBasisCents != null || balance === 0) {
        rothContributionBasis[account.id] = Math.min(
          balance,
          Math.max(0, account.rothContributionBasisCents ?? 0),
        );
      }
      if (cutoff.accountProvenanceChangedIds?.includes(account.id)) {
        unsupportedTaxCharacter[account.id] = true;
      }
    }
  }
  return {
    accounts: { ...cutoff.accounts },
    assets: { ...cutoff.assets },
    liabilities: { ...cutoff.liabilities },
    taxableBasis,
    taxableLots,
    unsupportedTaxCharacter,
    rothContributionBasis,
  };
};

const combineSources = (
  sources: readonly RetirementDrawSource[],
  more: readonly RetirementDrawSource[],
) => [...sources, ...more];

const aggregateSources = (
  sources: readonly RetirementDrawSource[],
): readonly RetirementDrawSource[] => {
  const aggregated = new Map<string, RetirementDrawSource>();
  for (const source of sources) {
    const key = `${source.accountId}:${source.taxYear}`;
    const prior = aggregated.get(key);
    if (prior == null) {
      aggregated.set(key, { ...source });
      continue;
    }
    const sameMethod = prior.taxEstimateMethod === source.taxEstimateMethod;
    aggregated.set(key, {
      ...prior,
      amountCents: prior.amountCents + source.amountCents,
      taxableGainCents: prior.taxableGainCents + source.taxableGainCents,
      ordinaryIncomeCents: prior.ordinaryIncomeCents + source.ordinaryIncomeCents,
      rothTaxableCents: prior.rothTaxableCents + source.rothTaxableCents,
      earlyPenaltyCents: prior.earlyPenaltyCents + source.earlyPenaltyCents,
      federalShortTermGainCents:
        prior.federalShortTermGainCents + source.federalShortTermGainCents,
      federalLongTermGainCents:
        prior.federalLongTermGainCents + source.federalLongTermGainCents,
      californiaGainCents: prior.californiaGainCents + source.californiaGainCents,
      taxEstimateMethod: sameMethod
        ? prior.taxEstimateMethod
        : prior.taxCharacterSupported && source.taxCharacterSupported
          ? "mixed-supported"
          : "unsupported",
      taxCharacterSupported: prior.taxCharacterSupported && source.taxCharacterSupported,
    });
  }
  return [...aggregated.values()];
};

const sumSources = (
  sources: readonly RetirementDrawSource[],
  key: "taxableGainCents" | "ordinaryIncomeCents" | "rothTaxableCents" |
    "earlyPenaltyCents" | "federalShortTermGainCents" | "federalLongTermGainCents" |
    "californiaGainCents",
) => sources.reduce((sum, source) => sum + source[key], 0);

const calculationErrorYear = (
  input: RetirementProjectionInput,
  periodStart: string,
  message: string,
  extraWarnings: readonly RetirementProjectionWarning[] = [],
): RetirementProjectionYear => {
  const year = Number(periodStart.slice(0, 4));
  return {
    year,
    ages: input.snapshot.household.people.map((person) => ({
      personId: person.id,
      name: person.name,
      age: ageOnDate(person.birthDate, `${periodStart}-01`),
    })),
    startingPortfolioCents: 0,
    withdrawalTargetCents: 0,
    withdrawalFundedCents: 0,
    otherPreTaxIncomeCents: 0,
    rentalIncomeCents: 0,
    estimatedTaxCents: 0,
    totalTaxCents: 0,
    typicalYearTaxCents: 0,
    earlyPenaltyCents: 0,
    afterTaxIncomeCents: 0,
    typicalAfterTaxIncomeCents: 0,
    planExpenseCents: 0,
    housingExpenseCents: 0,
    surplusCents: 0,
    shortfallCents: 0,
    destinationBalanceCents: 0,
    endingLiquidAccountsCents: 0,
    endingRetirementAccountsCents: 0,
    endingHomeEquityCents: 0,
    endingDebtCents: 0,
    endingOtherNetWorthCents: 0,
    endingNetWorthCents: 0,
    taxBreakdown: {
      ordinaryDistributionsCents: 0, shortTermGainsCents: 0, longTermGainsCents: 0,
      grossRentalIncomeCents: 0, federalTaxableRentalIncomeCents: 0,
      californiaTaxableRentalIncomeCents: 0, federalRentalDeductionsCents: 0,
      californiaRentalDeductionsCents: 0, federalDeductionCents: 0,
      californiaDeductionCents: 0, federalTaxableIncomeCents: 0,
      californiaTaxableIncomeCents: 0, federalIncomeTaxCents: 0,
      californiaIncomeTaxCents: 0, netInvestmentIncomeTaxCents: 0, homeSaleTaxCents: 0,
    },
    endingBalances: { accounts: {}, assets: {}, liabilities: {} },
    housing: {
      principalCents: 0,
      interestCents: 0,
      propertyTaxCents: 0,
      insuranceCents: 0,
      hoaCents: 0,
      maintenanceCents: 0,
    },
    withdrawalSources: [],
    warnings: [...extraWarnings, { code: "calculation-error", year, message }],
  };
};

const invalidStateMessage = (state: RetirementYearState) => {
  for (const [kind, values] of [
    ["account", state.accounts],
    ["asset", state.assets],
    ["liability", state.liabilities],
  ] as const) {
    for (const [entityId, value] of Object.entries(values)) {
      if (!Number.isSafeInteger(value)) return `Invalid ${kind} balance for ${entityId}.`;
    }
  }
  return undefined;
};

const reconcileLotMarketValue = (
  lots: TaxLotRecord[],
  balanceCents: Cents,
) => {
  const priorTotal = lots.reduce((sum, lot) => sum + lot.marketValueCents, 0);
  if (priorTotal <= 0) return;
  let allocated = 0;
  for (let index = 0; index < lots.length; index++) {
    const marketValueCents = index === lots.length - 1
      ? balanceCents - allocated
      : Math.round(balanceCents * lots[index].marketValueCents / priorTotal);
    lots[index] = { ...lots[index], marketValueCents };
    allocated += marketValueCents;
  }
};

const addCashLot = (
  state: RetirementYearState,
  accountId: string,
  amountCents: Cents,
  acquiredOn: string,
  id: string,
) => {
  const lots = state.taxableLots[accountId];
  if (lots == null || amountCents <= 0) return;
  lots.push({
    id,
    acquiredOn,
    marketValueCents: amountCents,
    federalBasisCents: amountCents,
    californiaBasisCents: amountCents,
  });
};

const uniqueWarnings = (warnings: readonly RetirementProjectionWarning[]) => {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.year ?? ""}:${warning.entityId ?? ""}:${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const runRetirementScenario = (
  input: RetirementProjectionInput,
  cutoff: ReturnType<typeof buildRetirementCutoff>,
  planMonths: ReturnType<typeof ProjectionEngine.calculate>[number]["months"],
  taxLedgers: ReadonlyMap<number, TaxLedger>,
  initialOrder: readonly string[],
  homeSale?: RetirementHomeSaleRollForward,
  planFailure?: { yearIndex: number; message: string },
): readonly RetirementProjectionYear[] => {
  let state = initialState(input, cutoff);
  let calculationFailure: string | undefined;
  const cutoffHomes = cutoff.properties.map((property) => ({
    assetId: property.assetId,
    liabilityId: property.liabilityId,
  }));
  let homes = homeSale == null
    ? [...cutoffHomes]
    : cutoffHomes.filter((home) => !homeSale.assetIds.includes(home.assetId));
  const selectedDestination = input.settings.taxableDestinationAccountId == null
    ? undefined
    : input.snapshot.accounts.find((account) =>
      account.id === input.settings.taxableDestinationAccountId &&
      isTaxableInvestmentAccount(account));
  const destinationId = selectedDestination?.id;
  const retirementSaleDate = `${input.settings.retirementMonth}-01`;
  const privateStockTaxSources: RetirementDrawSource[] = [];
  const privateStockIds = new Set(input.snapshot.assets
    .filter((asset) => asset.privateStock != null || asset.equityHolding != null)
    .map((asset) => asset.id));
  if (destinationId != null && state.accounts[destinationId] != null) {
    for (const asset of input.snapshot.assets) {
      if (!privateStockIds.has(asset.id)) continue;
      const proceedsCents = Math.max(0, state.assets[asset.id] ?? 0);
      if (proceedsCents <= 0) {
        delete state.assets[asset.id];
        continue;
      }
      let shortTermGainCents = 0;
      let longTermGainCents = 0;
      let estimateMethod: RetirementDrawSource["taxEstimateMethod"] = "conservative-aggregate-basis";
      if (asset.equityHolding != null) {
        const vestedEvents = asset.equityHolding.grants.flatMap((grant) => grant.vestEvents)
          .filter((event) => event.date < retirementSaleDate);
        const currentPriceCents = projectedSharePrice(asset.equityHolding, retirementSaleDate);
        const grossMarketCents = vestedEvents.reduce((sum, event) =>
          sum + valueForUnits(event.unitsMicros, currentPriceCents), 0);
        const scale = grossMarketCents > 0 ? proceedsCents / grossMarketCents : 0;
        const oneYearBefore = new Date(`${retirementSaleDate}T00:00:00Z`);
        oneYearBefore.setUTCFullYear(oneYearBefore.getUTCFullYear() - 1);
        const longTermCutoff = oneYearBefore.toISOString().slice(0, 10);
        for (const event of vestedEvents) {
          const market = Math.round(valueForUnits(event.unitsMicros, currentPriceCents) * scale);
          const basis = Math.round(valueForUnits(
            event.unitsMicros,
            event.actualFmvCents ?? projectedSharePrice(asset.equityHolding, event.date),
          ) * scale);
          const gain = Math.max(0, market - basis);
          if (event.date < longTermCutoff) longTermGainCents += gain;
          else shortTermGainCents += gain;
        }
        estimateMethod = "exact-tax-lots";
      } else {
        const recordedBasis = asset.taxableCostBasisCents ?? asset.taxLots?.reduce(
          (sum, lot) => sum + lot.federalBasisCents, 0,
        ) ?? proceedsCents;
        longTermGainCents = Math.max(0, proceedsCents - recordedBasis);
      }
      const taxableGainCents = shortTermGainCents + longTermGainCents;
      privateStockTaxSources.push({
        accountId: asset.id,
        taxYear: Number(input.settings.retirementMonth.slice(0, 4)),
        amountCents: proceedsCents,
        taxableGainCents,
        ordinaryIncomeCents: 0,
        rothTaxableCents: 0,
        earlyPenaltyCents: 0,
        federalShortTermGainCents: shortTermGainCents,
        federalLongTermGainCents: longTermGainCents,
        californiaGainCents: taxableGainCents,
        taxEstimateMethod: estimateMethod,
        taxCharacterSupported: true,
      });
      state.accounts[destinationId] += proceedsCents;
      state.taxableBasis[destinationId] = (state.taxableBasis[destinationId] ?? 0) + proceedsCents;
      addCashLot(state, destinationId, proceedsCents, retirementSaleDate, `retirement-private-stock-sale:${asset.id}`);
      delete state.assets[asset.id];
    }
  }
  const closingShortfallCents = Math.max(0, -(homeSale?.netProceedsCents ?? 0));
  if (homeSale != null) {
    for (const assetId of homeSale.assetIds) delete state.assets[assetId];
    for (const liabilityId of homeSale.liabilityIds) delete state.liabilities[liabilityId];
    if (homeSale.netProceedsCents > 0 && destinationId != null && state.accounts[destinationId] != null) {
      state.accounts[destinationId] += homeSale.netProceedsCents;
      state.taxableBasis[destinationId] = (state.taxableBasis[destinationId] ?? 0) +
        homeSale.netProceedsCents;
      addCashLot(state, destinationId, homeSale.netProceedsCents, `${input.settings.retirementMonth}-01`, "retirement-home-sale");
    }
  }
  const monthsByKey = new Map(planMonths.map((month) => [month.month, month]));
  const accountById = new Map(input.snapshot.accounts.map((account) => [account.id, account]));
  const eventById = new Map(input.scenario.events.map((event) => [event.id, event]));
  const assetSaleByEventId = new Map(input.scenario.events.flatMap((event) =>
    event.type === "asset-sale" ? [[event.id, event] as const] : []));

  return Array.from({ length: input.settings.horizonYears }, (_, index) => {
    const periodStart = addMonths(input.settings.retirementMonth, index * 12);
    if (planFailure != null && index >= planFailure.yearIndex) {
      calculationFailure ??= planFailure.message;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    if (calculationFailure != null) {
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    try {
    const taxHomeSale = homeSale == null || index === 0
      ? homeSale
      : { ...homeSale, sales: [] };
    const periodMonths = Array.from({ length: 12 }, (__, monthIndex) =>
      monthsByKey.get(addMonths(periodStart, monthIndex))).filter((month) => month != null);
    const year = Number(periodStart.slice(0, 4));
    if (periodMonths.length !== 12) {
      calculationFailure = `Missing monthly Plan data for retirement year ${year}.`;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    const openingStateError = invalidStateMessage(state);
    if (openingStateError != null) {
      calculationFailure = openingStateError;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    const provisionalStartingPortfolioCents = Math.max(
      0,
      portfolioValue(state, input.snapshot.accounts) -
        (index === 0 ? closingShortfallCents : 0),
    );
    let startingPortfolioCents=provisionalStartingPortfolioCents;
    let withdrawalTargetCents = Math.round(
      startingPortfolioCents * input.settings.withdrawalRateBps / 10_000,
    );

    const soldDuringPeriod = new Set<string>();
    let unsupportedPlanOutflowAccountId: string | undefined;
    const planDispositionSources: RetirementDrawSource[] = [];
    const privateSaleTaxSources = index === 0 ? privateStockTaxSources : [];
    for (const month of periodMonths) {
      for (const [accountId, balance] of Object.entries(state.accounts)) {
        const account = accountById.get(accountId);
        if (account) {
          state.accounts[accountId] = projectGrowth(balance, account.annualReturnBps, 1);
          const lots = state.taxableLots[accountId];
          if (lots) reconcileLotMarketValue(lots, state.accounts[accountId]);
        }
      }
      for (const transition of month.accountTransitions) {
        const saleEvent = transition.source === "asset-sale" && transition.eventId != null
          ? assetSaleByEventId.get(transition.eventId)
          : undefined;
        if (saleEvent != null && homeSale?.assetIds.includes(saleEvent.assetId)) continue;
        const account = accountById.get(transition.accountId);
        if (account == null || state.accounts[transition.accountId] == null) continue;
        const priorBalance = state.accounts[transition.accountId];
        const transitionDate = transition.eventId == null
          ? `${month.month}-01`
          : eventById.get(transition.eventId)?.date ?? `${month.month}-01`;
        if (transition.amountCents >= 0) {
          state.accounts[transition.accountId] = priorBalance + transition.amountCents;
          if (isTaxableInvestmentAccount(account)) {
            const priorBasis = state.taxableBasis[transition.accountId] ?? 0;
            state.taxableBasis[transition.accountId] = priorBasis + transition.amountCents;
            addCashLot(state, transition.accountId, transition.amountCents, transitionDate,
              `${transition.eventId ?? transition.recurringId ?? transition.source}:${month.month}`);
          } else if (account.subtype === "roth-ira" || account.subtype === "employer-roth") {
            if (transition.source === "account-contribution") {
              if (Object.prototype.hasOwnProperty.call(
                state.rothContributionBasis,
                transition.accountId,
              )) {
                state.rothContributionBasis[transition.accountId] =
                  state.rothContributionBasis[transition.accountId] + transition.amountCents;
              }
            } else if (transition.source === "account-transfer") {
              state.unsupportedTaxCharacter ??= {};
              state.unsupportedTaxCharacter[transition.accountId] = true;
            }
          }
        } else if (!isRetirementDrawableAccount(account)) {
          state.accounts[transition.accountId] = priorBalance + transition.amountCents;
        } else {
          const disposition = drawRetirementFunds({
            amountCents: -transition.amountCents,
            date: transitionDate,
            order: [transition.accountId],
            accounts: input.snapshot.accounts,
            balances: state.accounts,
            people: input.snapshot.household.people,
            taxableBasis: state.taxableBasis,
            taxableLots: state.taxableLots,
            unsupportedTaxCharacterAccountIds: Object.keys(state.unsupportedTaxCharacter ?? {}),
            rothContributionBasis: state.rothContributionBasis,
          });
          state = {
            ...state,
            accounts: { ...disposition.balances },
            taxableBasis: { ...disposition.taxableBasis },
            taxableLots: Object.fromEntries(Object.entries(disposition.taxableLots)
              .map(([accountId, lots]) => [accountId, lots.map((lot) => ({ ...lot }))])),
            rothContributionBasis: { ...disposition.rothContributionBasis },
          };
          planDispositionSources.push(...disposition.sources);
          if (disposition.unfundedCents > 0 || !disposition.taxCharacterSupported) {
            unsupportedPlanOutflowAccountId ??= transition.accountId;
          }
        }
        if (saleEvent != null) soldDuringPeriod.add(saleEvent.assetId);
      }
    }
    if (unsupportedPlanOutflowAccountId != null) {
      calculationFailure = `Tax treatment is unavailable for ${accountById.get(unsupportedPlanOutflowAccountId)?.name ?? unsupportedPlanOutflowAccountId}.`;
      const warning: RetirementProjectionWarning = {
        code: "unsupported-tax-character",
        year,
        entityId: unsupportedPlanOutflowAccountId,
        message: calculationFailure,
      };
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure, [warning]);
    }
    const accountReturnStateError = invalidStateMessage(state);
    if (accountReturnStateError != null) {
      calculationFailure = accountReturnStateError;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    const finalPlanMonth = periodMonths.at(-1);
    if (finalPlanMonth?.balances) {
      state.assets = {
        ...finalPlanMonth.balances.assets,
        ...Object.fromEntries(Object.entries(finalPlanMonth.balances.privateStock)
          .filter(([assetId]) => !privateStockIds.has(assetId))
          .map(([assetId, value]) => [assetId, value.vestedCents])),
      };
      for (const assetId of privateStockIds) delete state.assets[assetId];
      state.liabilities = { ...finalPlanMonth.balances.liabilities };
      if (homeSale != null) {
        for (const assetId of homeSale.assetIds) delete state.assets[assetId];
        for (const liabilityId of homeSale.liabilityIds) delete state.liabilities[liabilityId];
      }
    }
    if (soldDuringPeriod.size > 0) {
      homes = homes.filter((home) => !soldDuringPeriod.has(home.assetId));
    }
    const homeIds = new Set(homes.map((home) => home.assetId));
    for (const property of periodMonths.flatMap((month) => month.properties)) {
      if ((property.status === "active" || property.status === "owner-occupied") &&
        state.assets[property.assetId] != null &&
        !homeIds.has(property.assetId) &&
        !soldDuringPeriod.has(property.assetId) &&
        !(homeSale?.assetIds.includes(property.assetId) ?? false)) {
        homes.push({ assetId: property.assetId, liabilityId: property.liabilityId });
        homeIds.add(property.assetId);
      }
    }
    const endingPlanStateError = invalidStateMessage(state);
    if (endingPlanStateError != null) {
      calculationFailure = endingPlanStateError;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure);
    }

    const planHousing = periodMonths.reduce<RetirementProjectionYear["housing"]>((total, month) => ({
      principalCents: total.principalCents + month.housing.principalCents,
      interestCents: total.interestCents + month.housing.interestCents,
      propertyTaxCents: total.propertyTaxCents + month.housing.propertyTaxCents,
      insuranceCents: total.insuranceCents + month.housing.insuranceCents,
      hoaCents: total.hoaCents + month.housing.hoaCents,
      maintenanceCents: total.maintenanceCents + month.housing.maintenanceCents,
    }), {
      principalCents: 0,
      interestCents: 0,
      propertyTaxCents: 0,
      insuranceCents: 0,
      hoaCents: 0,
      maintenanceCents: 0,
    });
    const housing = homeSale == null ? planHousing : periodMonths.reduce<RetirementProjectionYear["housing"]>((total, month) => {
      for (const property of month.properties) {
        if (homeSale.assetIds.includes(property.assetId)) continue;
        total.principalCents += property.principalCents;
        total.interestCents += property.interestCents;
        total.propertyTaxCents += property.propertyTaxCents;
        total.insuranceCents += property.insuranceCents;
        total.hoaCents += property.hoaCents;
        total.maintenanceCents += property.maintenanceCents;
      }
      return total;
    }, {
      principalCents: 0,
      interestCents: 0,
      propertyTaxCents: 0,
      insuranceCents: 0,
      hoaCents: 0,
      maintenanceCents: 0,
    });
    const housingExpenseCents = Object.values(housing).reduce((sum, value) => sum + value, 0);
    const planRentalIncomeCents = periodMonths.reduce((sum, month) =>
      sum + month.properties.reduce((propertySum, property) =>
        propertySum + property.rentCents + property.aduIncomeCents, 0), 0);
    const rentalIncomeCents = homeSale == null ? planRentalIncomeCents : periodMonths.reduce((sum, month) =>
      sum + month.properties.reduce((propertySum, property) =>
        propertySum + (homeSale.assetIds.includes(property.assetId)
          ? 0
          : property.rentCents + property.aduIncomeCents), 0), 0);
    const otherPreTaxIncomeCents = periodMonths.reduce(
      (sum, month) => sum + month.incomeCents,
      0,
    ) - planRentalIncomeCents;
    const unsupportedRental=periodMonths.flatMap((month)=>month.properties).find((property)=>{
      if(homeSale?.assetIds.includes(property.assetId))return false;
      type RentalTreatmentEvent=Extract<Scenario["events"][number],{type:"asset-purchase"}>|Extract<Scenario["events"][number],{type:"property-rental-start"}>;
      const treatment=input.scenario.events.filter((event):event is RentalTreatmentEvent=>
        (event.type==="asset-purchase"||event.type==="property-rental-start")&&event.assetId===property.assetId&&event.date.slice(0,7)<=property.month!)
        .sort((left,right)=>left.date.localeCompare(right.date)||left.id.localeCompare(right.id)).at(-1);
      const details=treatment?.type==="asset-purchase"?treatment.propertyDetails:treatment;
      const nonPassive=details?.rentalType==="short-term"&&details.shortTermMaterialParticipation===true||
        details?.rentalType==="long-term"&&details.longTermRealEstateProfessional===true&&details.longTermMaterialParticipation===true;
      const currentAsset=input.snapshot.assets.find((asset)=>asset.id===property.assetId);
      const unresolvedCarryforward=(currentAsset?.federalPassiveLossCarryforwardCents??0)>0||
        (currentAsset?.californiaPassiveLossCarryforwardCents??0)>0;
      return property.rentCents+property.aduIncomeCents>0&&!property.rentalTaxModelingEnabled||
        property.taxableRentalCents<0&&!nonPassive||unresolvedCarryforward;
    });
    if(unsupportedRental!=null){
      calculationFailure=`Rental tax treatment is unavailable for ${unsupportedRental.name}.`;
      const warning:RetirementProjectionWarning={code:"unsupported-rental-tax",year,entityId:unsupportedRental.assetId,message:calculationFailure};
      state={accounts:{},assets:{},liabilities:{},taxableBasis:{},taxableLots:{},rothContributionBasis:{}};
      return calculationErrorYear(input,periodStart,calculationFailure,[warning]);
    }
    const planHousingExpenseCents = Object.values(planHousing)
      .reduce((sum, value) => sum + value, 0);
    const planExpenseCents = Math.max(
      0,
      periodMonths.reduce((sum, month) => sum + month.expenseCents, 0) -
        planHousingExpenseCents,
    );

    const periodEnd = addMonths(periodStart, 11);
    const drawDate = monthEndDate(periodEnd);
    const effectiveOrder = index === 0
      ? initialOrder
      : resolveRetirementAccountOrder(
        input.snapshot,
        drawDate,
        input.settings.withdrawalAccountOrder,
      );
    const makeTargetDraw=(amountCents:Cents)=>drawRetirementFunds({
      amountCents,
      date: drawDate,
      order: effectiveOrder,
      accounts: input.snapshot.accounts,
      balances: state.accounts,
      people: input.snapshot.household.people,
      taxableBasis: state.taxableBasis,
      taxableLots: state.taxableLots,
      unsupportedTaxCharacterAccountIds: Object.keys(state.unsupportedTaxCharacter ?? {}),
      rothContributionBasis: state.rothContributionBasis,
    });
    let targetDraw=makeTargetDraw(withdrawalTargetCents);
    if(index===0&&homeSale!=null){
      let anticipatedSaleTaxCents=homeSale.incrementalSaleTaxCents;
      for(let pass=0;pass<16;pass++){
        startingPortfolioCents=Math.max(0,provisionalStartingPortfolioCents-(anticipatedSaleTaxCents-homeSale.incrementalSaleTaxCents));
        withdrawalTargetCents=Math.round(startingPortfolioCents*input.settings.withdrawalRateBps/10_000);
        targetDraw=makeTargetDraw(withdrawalTargetCents);
        const nextSaleTaxCents=calculateIncomeTax(input,periodStart,periodMonths,taxLedgers,[...planDispositionSources,...targetDraw.sources,...privateSaleTaxSources],taxHomeSale).saleTaxCents;
        if(nextSaleTaxCents===anticipatedSaleTaxCents)break;
        anticipatedSaleTaxCents=nextSaleTaxCents;
      }
    }
    state = {
      ...state,
      accounts: { ...targetDraw.balances },
      taxableBasis: { ...targetDraw.taxableBasis },
      taxableLots: Object.fromEntries(Object.entries(targetDraw.taxableLots).map(([accountId, lots]) => [accountId, lots.map((lot) => ({ ...lot }))])),
      rothContributionBasis: { ...targetDraw.rothContributionBasis },
    };
    let withdrawalSources = [...targetDraw.sources];
    const unsupportedTargetSource = targetDraw.sources.find((source) => !source.taxCharacterSupported);
    if (unsupportedTargetSource != null) {
      calculationFailure = `Exact taxable gain treatment is unavailable for ${accountById.get(unsupportedTargetSource.accountId)?.name ?? unsupportedTargetSource.accountId}.`;
      const warning:RetirementProjectionWarning={
        code:"unsupported-tax-character",
        year,
        entityId:unsupportedTargetSource.accountId,
        message:calculationFailure,
      };
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure, [warning]);
    }
    let taxCalculation = calculateIncomeTax(
      input,
      periodStart,
      periodMonths,
      taxLedgers,
      [...planDispositionSources, ...withdrawalSources, ...privateSaleTaxSources],
      taxHomeSale,
    );
    let estimatedTaxCents = taxCalculation.retirementTaxCents;
    let saleTaxCents = index === 0 ? taxCalculation.saleTaxCents : 0;
    let earlyPenaltyCents = sumSources(
      [...planDispositionSources, ...withdrawalSources],
      "earlyPenaltyCents",
    );
    let afterTaxIncomeCents = targetDraw.fundedCents + otherPreTaxIncomeCents +
      rentalIncomeCents - estimatedTaxCents - earlyPenaltyCents;
    const saleTaxAdjustmentCents = index === 0 && homeSale != null
      ? saleTaxCents - homeSale.incrementalSaleTaxCents
      : 0;
    if (saleTaxAdjustmentCents < 0 && destinationId != null && state.accounts[destinationId] != null) {
      const refundCents = -saleTaxAdjustmentCents;
      state.accounts[destinationId] += refundCents;
      state.taxableBasis[destinationId] = (state.taxableBasis[destinationId] ?? 0) + refundCents;
      addCashLot(state, destinationId, refundCents, `${periodStart}-01`, "retirement-home-sale-tax-refund");
    }
    const expenses = planExpenseCents + housingExpenseCents +
      (index === 0 ? closingShortfallCents : 0) + Math.max(0, saleTaxAdjustmentCents);
    const surplusCents = Math.max(0, afterTaxIncomeCents - expenses);
    let shortfallCents = Math.max(0, expenses - afterTaxIncomeCents);
    let unfundedSpendingCents = 0;
    const warnings: RetirementProjectionWarning[] = [];
    if (index === 0 && destinationId == null) warnings.push({
      code: "missing-destination",
      year,
      entityId: input.settings.taxableDestinationAccountId ?? undefined,
      message: "Select an existing taxable investment account for retirement proceeds and cash flow.",
    });
    for (const entry of input.snapshot.recurring) {
      const endMonth = entry.endDate?.slice(0, 7);
      if (endMonth != null && endMonth >= periodStart && endMonth <= periodEnd) warnings.push({
        code: "activity-ended",
        year,
        entityId: entry.id,
        message: `${entry.name} ends on ${entry.endDate}.`,
      });
    }

    if (destinationId == null && (surplusCents > 0 || index === 0 && (homeSale?.netProceedsCents ?? 0) > 0)) {
      calculationFailure = "A taxable destination is required to preserve retirement surplus and sale proceeds.";
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure, warnings);
    }
    if (surplusCents > 0 && destinationId != null && state.accounts[destinationId] != null) {
      state.accounts[destinationId] += surplusCents;
      state.taxableBasis[destinationId] = (state.taxableBasis[destinationId] ?? 0) + surplusCents;
      addCashLot(state, destinationId, surplusCents, `${periodEnd}-01`, `retirement-surplus:${periodEnd}`);
    } else if (shortfallCents > 0) {
      const cashShortfallCents = shortfallCents;
      const shortfallOrder = destinationId == null
        ? effectiveOrder
        : [destinationId, ...effectiveOrder.filter((accountId) => accountId !== destinationId)];
      const availableCents = [...new Set(shortfallOrder)].reduce((sum, accountId) =>
        sum + Math.max(0, state.accounts[accountId] ?? 0), 0);
      const evaluateDraw = (amountCents: Cents) => {
        const draw = drawRetirementFunds({
          amountCents,
          date: drawDate,
          order: shortfallOrder,
          accounts: input.snapshot.accounts,
          balances: state.accounts,
          people: input.snapshot.household.people,
          taxableBasis: state.taxableBasis,
          taxableLots: state.taxableLots,
          unsupportedTaxCharacterAccountIds: Object.keys(state.unsupportedTaxCharacter ?? {}),
          rothContributionBasis: state.rothContributionBasis,
        });
        const combined = combineSources(withdrawalSources, draw.sources);
        const combinedTaxSources = [...planDispositionSources, ...combined, ...privateSaleTaxSources];
        const updatedTax = calculateIncomeTax(
          input,
          periodStart,
          periodMonths,
          taxLedgers,
          combinedTaxSources,
          taxHomeSale,
        );
        const updatedTaxCents=updatedTax.retirementTaxCents;
        const updatedSaleTaxCents=index===0?updatedTax.saleTaxCents:0;
        const updatedPenaltyCents = sumSources(combinedTaxSources, "earlyPenaltyCents");
        const addedTaxAndPenalty = Math.max(
          0,
          updatedTaxCents + updatedSaleTaxCents + updatedPenaltyCents -
            estimatedTaxCents - saleTaxCents - earlyPenaltyCents,
        );
        return {
          draw,
          combined,
          updatedTaxCents,
          updatedSaleTaxCents,
          updatedTaxBreakdown: updatedTax.breakdown,
          updatedPenaltyCents,
          addedTaxAndPenalty,
          netFundingCents: draw.fundedCents - addedTaxAndPenalty,
        };
      };
      let selected = evaluateDraw(availableCents);
      if (selected.netFundingCents >= cashShortfallCents) {
        let low = 0;
        let high = availableCents;
        // A safe integer contains at most 53 binary digits, so 64 iterations find the
        // smallest gross draw whose after-tax proceeds cover the cent-denominated need.
        for (let pass = 0; pass < 64 && low < high; pass++) {
          const middle = Math.floor((low + high) / 2);
          const candidate = evaluateDraw(middle);
          if (candidate.netFundingCents >= cashShortfallCents) {
            high = middle;
            selected = candidate;
          } else low = middle + 1;
        }
        if (selected.draw.fundedCents !== high) selected = evaluateDraw(high);
      }
      state = {
        ...state,
        accounts: { ...selected.draw.balances },
        taxableBasis: { ...selected.draw.taxableBasis },
        taxableLots: Object.fromEntries(Object.entries(selected.draw.taxableLots).map(([accountId, lots]) => [accountId, lots.map((lot) => ({ ...lot }))])),
        rothContributionBasis: { ...selected.draw.rothContributionBasis },
      };
      withdrawalSources = selected.combined;
      const unsupportedShortfallSource = selected.draw.sources.find((source) => !source.taxCharacterSupported);
      if (unsupportedShortfallSource != null) {
        calculationFailure = `Exact taxable gain treatment is unavailable for ${accountById.get(unsupportedShortfallSource.accountId)?.name ?? unsupportedShortfallSource.accountId}.`;
        const warning:RetirementProjectionWarning={code:"unsupported-tax-character",year,entityId:unsupportedShortfallSource.accountId,message:calculationFailure};
        state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, taxableLots: {}, rothContributionBasis: {} };
        return calculationErrorYear(input, periodStart, calculationFailure, [warning]);
      }
      estimatedTaxCents = selected.updatedTaxCents;
      saleTaxCents = selected.updatedSaleTaxCents;
      taxCalculation = {
        retirementTaxCents: selected.updatedTaxCents,
        saleTaxCents: selected.updatedSaleTaxCents,
        breakdown: selected.updatedTaxBreakdown,
      };
      earlyPenaltyCents = selected.updatedPenaltyCents;
      shortfallCents += selected.addedTaxAndPenalty;
      unfundedSpendingCents = Math.max(0, cashShortfallCents - selected.netFundingCents);
      afterTaxIncomeCents = withdrawalSources.reduce((sum, source) => sum + source.amountCents, 0) + otherPreTaxIncomeCents +
        rentalIncomeCents - estimatedTaxCents - earlyPenaltyCents;
    }

    if (earlyPenaltyCents > 0) warnings.push({
      code: "early-withdrawal",
      year,
      message: `${earlyPenaltyCents} cents of early-distribution penalties were estimated.`,
    });
    const allWithdrawalSources = [...planDispositionSources, ...withdrawalSources];
    for (const source of allWithdrawalSources) {
      if (source.taxEstimateMethod === "conservative-aggregate-basis") warnings.push({
        code: "conservative-taxable-basis",
        year,
        entityId: source.accountId,
        message: "Taxable gains use a conservative aggregate-basis estimate because exact tax lots are not stored.",
      });
    }
    for (const accountId of new Set(allWithdrawalSources
      .map((source) => source.accountId)
      .filter((accountId) => (state.accounts[accountId] ?? 0) === 0))) {
      warnings.push({
        code: "account-depleted",
        year,
        entityId: accountId,
        message: `${accountById.get(accountId)?.name ?? accountId} was depleted.`,
      });
    }
    if (unfundedSpendingCents > 0) warnings.push({
      code: "unfunded-spending",
      year,
      message: `${unfundedSpendingCents} cents of spending could not be funded.`,
    });
    const endingLiquidAccountsCents = input.snapshot.accounts.reduce((sum, account) =>
      account.kind !== "retirement" && account.kind !== "credit"
        ? sum + (state.accounts[account.id] ?? 0)
        : sum, 0);
    const endingRetirementAccountsCents = input.snapshot.accounts.reduce((sum, account) =>
      account.kind === "retirement" ? sum + (state.accounts[account.id] ?? 0) : sum, 0);
    const endingHomeIds = new Set(input.snapshot.assets
      .filter((asset) => asset.housingCosts != null)
      .map((asset) => asset.id));
    const endingHomeEquityCents = [...endingHomeIds].reduce(
      (sum, assetId) => sum + (state.assets[assetId] ?? 0), 0,
    ) - input.snapshot.liabilities.reduce((sum, liability) =>
      liability.mortgage?.assetId != null && endingHomeIds.has(liability.mortgage.assetId)
        ? sum + (state.liabilities[liability.id] ?? 0)
        : sum, 0);
    const endingNetWorthCents = sumRecord(state.accounts) + sumRecord(state.assets) -
      sumRecord(state.liabilities);
    const endingDebtCents = sumRecord(state.liabilities);
    const endingOtherNetWorthCents = endingNetWorthCents - endingLiquidAccountsCents -
      endingRetirementAccountsCents - endingHomeEquityCents;
    const taxWithoutPrivateStock = privateSaleTaxSources.length === 0
      ? taxCalculation
      : calculateIncomeTax(
        input,
        periodStart,
        periodMonths,
        taxLedgers,
        [...planDispositionSources, ...withdrawalSources],
        taxHomeSale,
      );
    const privateStockSaleTaxCents = Math.max(
      0,
      estimatedTaxCents + saleTaxCents -
        taxWithoutPrivateStock.retirementTaxCents - taxWithoutPrivateStock.saleTaxCents,
    );
    const privateStockGrossProceedsCents = privateSaleTaxSources.reduce(
      (sum, source) => sum + source.amountCents, 0,
    );
    const privateStockTaxableGainCents = privateSaleTaxSources.reduce(
      (sum, source) => sum + source.taxableGainCents, 0,
    );
    const typicalTaxCalculation = calculateIncomeTax(
      input,
      periodStart,
      periodMonths,
      taxLedgers,
      targetDraw.sources,
      taxHomeSale == null ? undefined : { ...taxHomeSale, sales: [] },
    );
    const typicalEarlyPenaltyCents = sumSources(targetDraw.sources, "earlyPenaltyCents");
    const typicalYearTaxCents = typicalTaxCalculation.retirementTaxCents;
    const typicalAfterTaxIncomeCents = targetDraw.fundedCents + otherPreTaxIncomeCents +
      rentalIncomeCents - typicalYearTaxCents - typicalEarlyPenaltyCents;
    return {
      year,
      ages: input.snapshot.household.people.map((person) => ({
        personId: person.id,
        name: person.name,
        age: ageOnDate(person.birthDate, `${periodStart}-01`),
      })),
      startingPortfolioCents,
      withdrawalTargetCents,
      withdrawalFundedCents: targetDraw.fundedCents,
      otherPreTaxIncomeCents,
      rentalIncomeCents,
      estimatedTaxCents,
      totalTaxCents: estimatedTaxCents + saleTaxCents,
      typicalYearTaxCents,
      earlyPenaltyCents,
      afterTaxIncomeCents,
      typicalAfterTaxIncomeCents,
      planExpenseCents,
      housingExpenseCents,
      surplusCents,
      shortfallCents,
      destinationBalanceCents: destinationId == null ? 0 : state.accounts[destinationId] ?? 0,
      endingLiquidAccountsCents,
      endingRetirementAccountsCents,
      endingHomeEquityCents,
      endingDebtCents,
      endingOtherNetWorthCents,
      endingNetWorthCents,
      taxBreakdown: taxCalculation.breakdown,
      ...(privateStockGrossProceedsCents > 0 ? { privateStockSale: {
        grossProceedsCents: privateStockGrossProceedsCents,
        taxableGainCents: privateStockTaxableGainCents,
        estimatedTaxCents: privateStockSaleTaxCents,
        netProceedsCents: privateStockGrossProceedsCents - privateStockSaleTaxCents,
      } } : {}),
      endingBalances: {
        accounts: { ...state.accounts },
        assets: { ...state.assets },
        liabilities: { ...state.liabilities },
      },
      housing,
      ...(index === 0 && homeSale != null ? { homeSale: {
        grossSaleValueCents: homeSale.grossSaleValueCents,
        sellingCostsCents: homeSale.sellingCostsCents,
        mortgagePayoffCents: homeSale.mortgagePayoffCents,
        incrementalSaleTaxCents: saleTaxCents,
        netProceedsCents: homeSale.grossSaleValueCents-homeSale.sellingCostsCents-homeSale.mortgagePayoffCents-saleTaxCents,
      } } : {}),
      withdrawalSources: aggregateSources(allWithdrawalSources),
      warnings,
    };
    } catch(error) {
      calculationFailure=error instanceof Error?error.message:"Unknown retirement projection error.";
      state={accounts:{},assets:{},liabilities:{},taxableBasis:{},taxableLots:{},rothContributionBasis:{}};
      return calculationErrorYear(input,periodStart,calculationFailure);
    }
  });
};

const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : "Unknown retirement projection error.";

const setupFailureResult = (
  input: RetirementProjectionInput,
  message: string,
  code: RetirementProjectionWarning["code"] = "calculation-error",
): RetirementProjectionResult => {
  const safeStartMonth = (() => {
    try {
      parseMonth(input.settings.retirementMonth);
      return input.settings.retirementMonth;
    } catch {
      const asOfMonth = input.asOfDate.slice(0, 7);
      try {
        parseMonth(asOfMonth);
        return asOfMonth;
      } catch {
        return "2000-01";
      }
    }
  })();
  const warning: RetirementProjectionWarning = { code, message };
  const unavailable: UnavailableRetirementScenarioProjection = {
    available: false,
    issues: [],
    warnings: [warning],
    years: [],
  };
  return {
    retirementMonth: input.settings.retirementMonth,
    firstWithdrawalDate: monthEndDate(addMonths(safeStartMonth, 11)),
    withdrawalRateBps: input.settings.withdrawalRateBps,
    netWorthCents: null,
    keepHomes: unavailable,
    sellHomes: unavailable,
    effectiveWithdrawalOrder: resolveRetirementAccountOrder(
      input.snapshot,
      `${safeStartMonth}-01`,
      input.settings.withdrawalAccountOrder,
    ),
    resolvedHomeSales: null,
    warnings: [warning],
  };
};

interface RetirementPlanBoundaryResult {
  planMonths: ReturnType<typeof ProjectionEngine.calculate>[number]["months"];
  taxLedgers: ReadonlyMap<number, TaxLedger>;
  planFailure?: { yearIndex: number; message: string };
}

const calculateRetirementPlanBoundary = (
  input: RetirementProjectionInput,
  baseScenario: Scenario,
): RetirementPlanBoundaryResult => {
  let projections: ReturnType<typeof calculateRetirementPlan> = [];
  let planFailure: { yearIndex: number; message: string } | undefined;
  try {
    const fullScenario = extendScenarioHorizon(
      { ...baseScenario, contributions: [], withdrawals: [] },
      input.settings.retirementMonth,
      input.settings.horizonYears,
      input.asOfDate.slice(0, 7),
    );
    projections = calculateRetirementPlan(
      input.snapshot,
      fullScenario,
      input.asOfDate,
      { stopEmploymentMonth: input.settings.retirementMonth },
    );
  } catch (fullProjectionError) {
    for (let yearIndex = 0; yearIndex < input.settings.horizonYears; yearIndex++) {
      try {
        const prefixScenario = extendScenarioHorizon(
          { ...baseScenario, contributions: [], withdrawals: [] },
          input.settings.retirementMonth,
          yearIndex + 1,
          input.asOfDate.slice(0, 7),
        );
        projections = calculateRetirementPlan(
          input.snapshot,
          prefixScenario,
          input.asOfDate,
          { stopEmploymentMonth: input.settings.retirementMonth },
        );
      } catch (error) {
        planFailure = { yearIndex, message: errorMessage(error) };
        break;
      }
    }
    planFailure ??= { yearIndex: 0, message: errorMessage(fullProjectionError) };
  }
  return {
    planMonths: projections.flatMap((projection) => projection.months),
    taxLedgers: new Map(projections.flatMap((projection) =>
      projection.taxLedger == null ? [] : [[projection.year, projection.taxLedger] as const])),
    planFailure,
  };
};

const withoutRetirementSoldHomeActivity = (
  scenario: Scenario,
  retirementMonth: string,
  homeSale: RetirementHomeSaleRollForward,
): Scenario => {
  const soldAssetIds = new Set(homeSale.assetIds);
  const soldLiabilityIds = new Set(homeSale.liabilityIds);
  return {
    ...scenario,
    events: scenario.events.filter((event) => {
      if (event.date.slice(0, 7) < retirementMonth) return true;
      if ((event.type === "adu-build" || event.type === "property-rental-start" || event.type === "asset-sale") &&
        soldAssetIds.has(event.assetId)) return false;
      if (event.type === "debt-payoff" && soldLiabilityIds.has(event.liabilityId)) return false;
      return true;
    }),
  };
};

export function calculateRetirementProjection(
  input: RetirementProjectionInput,
): RetirementProjectionResult {
  const destination = input.settings.taxableDestinationAccountId == null
    ? undefined
    : input.snapshot.accounts.find((account) =>
      account.id === input.settings.taxableDestinationAccountId &&
      isTaxableInvestmentAccount(account));
  if (destination == null) {
    return setupFailureResult(
      input,
      "Select an existing taxable investment account for retirement proceeds and cash flow.",
      "missing-destination",
    );
  }
  const setupInput = {
    snapshot: input.snapshot,
    scenario: input.scenario,
    retirementMonth: input.settings.retirementMonth,
    asOfDate: input.asOfDate,
  };
  let cutoff: ReturnType<typeof buildRetirementCutoff>;
  try {
    extendScenarioHorizon(
      input.scenario,
      input.settings.retirementMonth,
      input.settings.horizonYears,
      input.asOfDate.slice(0, 7),
    );
    cutoff = buildRetirementCutoff(setupInput);
  } catch (error) {
    return setupFailureResult(input, errorMessage(error));
  }

  const snapshotInput = {
    cutoff,
    snapshot: input.snapshot,
    scenario: input.scenario,
    withdrawalRateBps: input.settings.withdrawalRateBps,
  };
  let keepSnapshot: RetirementKeepSnapshotResult;
  let retirementSnapshot: RetirementSnapshotResult | undefined;
  let resolvedHomeSales: ResolvedRetirementHomeSales | undefined;
  let sellSetupError: string | undefined;
  try {
    retirementSnapshot = calculateRetirementSnapshot(snapshotInput);
    keepSnapshot = retirementSnapshot;
    resolvedHomeSales = resolveRetirementHomeSales(snapshotInput);
  } catch (error) {
    sellSetupError = errorMessage(error);
    try {
      keepSnapshot = calculateRetirementKeepSnapshot(snapshotInput);
    } catch (keepError) {
      return setupFailureResult(input, errorMessage(keepError));
    }
  }

  const keepPlan = calculateRetirementPlanBoundary(input, input.scenario);
  const firstWithdrawalDate = monthEndDate(
    addMonths(input.settings.retirementMonth, 11),
  );
  const effectiveWithdrawalOrder = resolveRetirementAccountOrder(
    input.snapshot,
    firstWithdrawalDate,
    input.settings.withdrawalAccountOrder,
  );
  const keepYears = runRetirementScenario(
    input,
    cutoff,
    keepPlan.planMonths,
    keepPlan.taxLedgers,
    effectiveWithdrawalOrder,
    undefined,
    keepPlan.planFailure,
  );
  const sellSetupAvailable = sellSetupError == null &&
    retirementSnapshot?.sellHomes.available === true &&
    resolvedHomeSales != null;
  const sellHomeRollForward: RetirementHomeSaleRollForward | undefined = sellSetupAvailable
    ? {
      assetIds: resolvedHomeSales!.homes.map((home) => home.property.assetId),
      liabilityIds: resolvedHomeSales!.homes.flatMap((home) =>
        home.liabilityId == null ? [] : [home.liabilityId]),
      grossSaleValueCents: resolvedHomeSales!.sales.reduce(
        (sum, sale) => sum + sale.salePriceCents,
        0,
      ),
      sellingCostsCents: retirementSnapshot!.sellHomes.available ? retirementSnapshot!.sellHomes.sellingCostsCents : 0,
      mortgagePayoffCents: resolvedHomeSales!.homes.reduce(
        (sum, home) => sum + home.mortgageCents,
        0,
      ),
      incrementalSaleTaxCents: retirementSnapshot!.sellHomes.available ? retirementSnapshot!.sellHomes.incrementalSaleTaxCents : 0,
      netProceedsCents: retirementSnapshot!.sellHomes.available ? retirementSnapshot!.sellHomes.netHomeProceedsCents : 0,
      sales: resolvedHomeSales!.sales,
    }
    : undefined;
  const sellPlan = sellHomeRollForward == null
    ? undefined
    : calculateRetirementPlanBoundary(
      input,
      withoutRetirementSoldHomeActivity(input.scenario, input.settings.retirementMonth, sellHomeRollForward),
    );
  const sellYears = sellHomeRollForward != null && sellPlan != null
    ? runRetirementScenario(
      input,
      cutoff,
      sellPlan.planMonths,
      sellPlan.taxLedgers,
      effectiveWithdrawalOrder,
      sellHomeRollForward,
      sellPlan.planFailure,
    )
    : undefined;
  const unavailableSellWarnings: readonly RetirementProjectionWarning[] = sellSetupError != null
    ? [{ code: "calculation-error", message: sellSetupError }]
    : retirementSnapshot?.sellHomes.available === false
      ? retirementSnapshot.sellHomes.issues.map((issue): RetirementProjectionWarning => ({
      code: "missing-home-data",
      entityId: issue.assetId,
      message: issue.message,
      }))
      : [];
  const keepFailureWarnings = uniqueWarnings(keepYears.flatMap((year) => year.warnings)
    .filter((warning) => warning.code === "calculation-error" ||
      warning.code === "unsupported-tax-character" ||
      warning.code === "unsupported-rental-tax"));
  const keepAvailable = keepFailureWarnings.length === 0;
  const sellFailureWarnings = sellYears == null
    ? unavailableSellWarnings
    : uniqueWarnings(sellYears.flatMap((year) => year.warnings)
      .filter((warning) => warning.code === "calculation-error" ||
        warning.code === "unsupported-tax-character" ||
        warning.code === "unsupported-rental-tax"));
  const sellAvailable = sellSetupAvailable && sellYears != null &&
    sellFailureWarnings.length === 0;
  const resultWarnings = uniqueWarnings([
    ...(keepAvailable ? keepYears.flatMap((year) => year.warnings) : keepFailureWarnings),
    ...(sellAvailable ? sellYears!.flatMap((year) => year.warnings) : sellFailureWarnings),
  ]);
  const keepFirstYear = keepAvailable ? keepYears[0] : undefined;
  const keepPrivateStockTaxCents = keepFirstYear?.privateStockSale?.estimatedTaxCents ?? 0;
  const keepSummary = keepFirstYear == null
    ? undefined
    : {
      ...keepSnapshot.keepHomes,
      nonHomeNetWorthCents: keepSnapshot.keepHomes.nonHomeNetWorthCents -
        keepPrivateStockTaxCents,
      withdrawalIncomeCents: keepFirstYear.withdrawalFundedCents,
      grossRentalIncomeCents: keepFirstYear.rentalIncomeCents,
      annualPreTaxIncomeCents: keepFirstYear.withdrawalFundedCents +
        keepFirstYear.otherPreTaxIncomeCents + keepFirstYear.rentalIncomeCents,
    };
  const sellSummary=sellAvailable&&sellYears?.[0].homeSale!=null
    ?{
      ...retirementSnapshot!.sellHomes,
      incrementalSaleTaxCents:sellYears[0].homeSale.incrementalSaleTaxCents,
      netHomeProceedsCents:sellYears[0].homeSale.netProceedsCents,
      liquidNetWorthCents:sellYears[0].startingPortfolioCents-
        (sellYears[0].privateStockSale?.estimatedTaxCents??0),
      annualPreTaxIncomeCents:sellYears[0].withdrawalFundedCents+
        sellYears[0].otherPreTaxIncomeCents+sellYears[0].rentalIncomeCents,
    }
    :retirementSnapshot?.sellHomes;

  return {
    retirementMonth: keepSnapshot.retirementMonth,
    firstWithdrawalDate,
    withdrawalRateBps: keepSnapshot.withdrawalRateBps,
    netWorthCents: keepSnapshot.netWorthCents - keepPrivateStockTaxCents,
    keepHomes: keepAvailable
      ? {
        available: true,
        summary: keepSummary!,
        years: keepYears,
        warnings: uniqueWarnings(keepYears.flatMap((year) => year.warnings)),
      }
      : { available: false, issues: [], warnings: keepFailureWarnings, years: [] },
    sellHomes: sellAvailable
      ? {
        available: true,
        summary: sellSummary as Extract<SellHomesResult,{available:true}>,
        years: sellYears!,
        warnings: uniqueWarnings(sellYears!.flatMap((year) => year.warnings)),
      }
      : {
        available: false,
        issues: retirementSnapshot?.sellHomes.available === false ? retirementSnapshot.sellHomes.issues : [],
        warnings: sellFailureWarnings,
        years: [],
      },
    effectiveWithdrawalOrder,
    resolvedHomeSales: resolvedHomeSales ?? null,
    warnings: resultWarnings,
  };
}
