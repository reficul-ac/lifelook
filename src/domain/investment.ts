import { projectedTaxRules } from "./tax";
import type { BasisPoints, Cents, FilingStatus, TaxBracket } from "./types";

export interface InvestmentAssumptions {
  fireWithdrawalRateBps: BasisPoints;
  retirementIncomeMode: "current" | "desired";
  annualRetirementIncomeCents: Cents;
  primaryResidence: boolean;
  rentalUseBps: BasisPoints;
  homePriceCents: Cents;
  homeSquareFeet: number;
  aduPlanned: boolean;
  aduSquareFeet: number;
  aduBuildYear: number;
  aduBuildCostCents: Cents;
  aduMonthlyRentCents: Cents;
  downPaymentBps: BasisPoints;
  mortgageRateBps: BasisPoints;
  mortgageTermYears: number;
  monthlyRentCents: Cents;
  stockReturnBps: BasisPoints;
  homeAppreciationBps: BasisPoints;
  horizonYears: number;
  purchaseCostBps: BasisPoints;
  sellingCostBps: BasisPoints;
  rentGrowthBps: BasisPoints;
  propertyTaxBps: BasisPoints;
  annualInsuranceCents: Cents;
  insuranceGrowthBps: BasisPoints;
  monthlyHoaCents: Cents;
  hoaGrowthBps: BasisPoints;
  maintenanceBps: BasisPoints;
  monthlyRentalIncomeCents: Cents;
  rentalIncomeGrowthBps: BasisPoints;
  factorRentalTaxes: boolean;
  propertyTaxBasisOverrideCents: Cents | null;
  buildingBasisOverrideCents: Cents | null;
  mfsLivedApartAllYear: boolean;
  rentalType: "long-term" | "short-term";
  shortTermMaterialParticipation: boolean;
  longTermRealEstateProfessional: boolean;
  longTermMaterialParticipation: boolean;
}
export interface InvestmentTaxYearContext {
  year: number;
  federalTaxableCents: Cents;
  californiaTaxableCents: Cents;
  federalTaxCents: Cents;
  californiaTaxCents: Cents;
  modifiedAgiCents: Cents;
}
export interface InvestmentTaxContext {
  filingStatus: FilingStatus;
  thresholdInflationBps: BasisPoints;
  startMonth: string;
  years: readonly InvestmentTaxYearContext[];
}
export interface InvestmentComparisonRecord {
  householdId: string;
  assumptions: InvestmentAssumptions;
  revision: number;
}
export interface InvestmentValidationError {
  field: keyof InvestmentAssumptions | "comparison" | "taxContext";
  message: string;
  month?: number;
  year?: number;
}
export interface InvestmentMonth {
  month: number;
  stockValueCents: Cents;
  homeValueCents: Cents;
  mortgageBalanceCents: Cents;
  equityCents: Cents;
  saleProceedsCents: Cents;
  rentalPortfolioCents: Cents;
  buyRetainedTotalCents: Cents;
  buySaleTotalCents: Cents;
  rentalIncomeCents: Cents;
  principalCents: Cents;
  interestCents: Cents;
  ownerOutlayCents: Cents;
  rentCents: Cents;
  stockContributionCents: Cents;
  deductibleOperatingExpensesCents: Cents;
  depreciationCents: Cents;
  accumulatedDepreciationCents: Cents;
  federalAllowedRentalCents: Cents;
  californiaAllowedRentalCents: Cents;
  federalPassiveCarryforwardCents: Cents;
  californiaPassiveCarryforwardCents: Cents;
  baselineTaxCents: Cents;
  buyTaxCents: Cents;
  netTaxDeltaCents: Cents;
  taxAdjustedBuyContributionCents: Cents;
}
export interface InvestmentYear extends Omit<
  InvestmentMonth,
  "month" | "principalCents" | "interestCents"
> {
  year: number;
  calendarYear: number;
  principalCents: Cents;
  interestCents: Cents;
}
export interface InvestmentCrossover {
  month: number;
  year: number;
  leader: "rent-invest" | "buy";
}
export interface InvestmentResult {
  months: InvestmentMonth[];
  years: InvestmentYear[];
  equityCrossovers: InvestmentCrossover[];
  saleCrossovers: InvestmentCrossover[];
  taxRuleYears: number[];
  retirementYears: RetirementYearResult[];
}
export type RetirementPath = "stocks" | "keep" | "sell";
export interface RetirementPathResult {
  path: RetirementPath;
  wealthCents: Cents;
  grossStockWithdrawalCents: Cents;
  realizedShortTermGainCents: Cents;
  realizedLongTermGainCents: Cents;
  propertyGrossRentCents: Cents;
  propertyCashCostsCents: Cents;
  incrementalTaxCents: Cents;
  afterTaxInvestmentIncomeCents: Cents;
  totalAfterTaxIncomeCents: Cents;
  effectiveYieldBps: BasisPoints;
  targetCoverageBps: BasisPoints | null;
  shortfallCents: Cents;
  requiredStockValueCents: Cents;
  additionalStockValueCents: Cents;
}
export interface RetirementYearResult {
  year: number;
  calendarYear: number;
  retirementMonth: number;
  inflationFactor: number;
  targetCents: Cents | null;
  paths: Record<RetirementPath, RetirementPathResult>;
}
export type InvestmentCalculation =
  | { ok: true; result: InvestmentResult }
  | { ok: false; errors: InvestmentValidationError[] };
type StockLot = { value: number; basis: number; acquiredMonth: number };
const applyLotFlow = (lots: StockLot[], flow: number, month: number) => {
  if (flow >= 0) { if (flow) lots.push({value:flow,basis:flow,acquiredMonth:month}); return; }
  let sale = -flow;
  while (sale > .01 && lots.length) { const lot=lots[0], used=Math.min(sale,lot.value), ratio=used/lot.value; lot.value-=used;lot.basis-=lot.basis*ratio;sale-=used;if(lot.value<.01)lots.shift(); }
};
const sellLotsFifo = (source: readonly StockLot[], amount: number, month: number) => {
  const lots=source.map(x=>({...x})); let remaining=Math.min(amount,lots.reduce((s,x)=>s+x.value,0)), short=0,long=0;
  while(remaining>.01&&lots.length){const lot=lots.shift()!,used=Math.min(remaining,lot.value),basis=lot.basis*used/lot.value,gain=Math.max(0,used-basis);if(month-lot.acquiredMonth<=12)short+=gain;else long+=gain;remaining-=used;}
  return {short,long};
};

export const defaultInvestmentAssumptions: InvestmentAssumptions = {
  fireWithdrawalRateBps: 300,
  retirementIncomeMode: "current",
  annualRetirementIncomeCents: 0,
  primaryResidence: false,
  rentalUseBps: 0,
  homePriceCents: 50_000_000,
  homeSquareFeet: 1_500,
  aduPlanned: false,
  aduSquareFeet: 500,
  aduBuildYear: 5,
  aduBuildCostCents: 15_000_000,
  aduMonthlyRentCents: 200_000,
  downPaymentBps: 2000,
  mortgageRateBps: 650,
  mortgageTermYears: 30,
  monthlyRentCents: 250_000,
  stockReturnBps: 700,
  homeAppreciationBps: 300,
  horizonYears: 30,
  purchaseCostBps: 300,
  sellingCostBps: 600,
  rentGrowthBps: 300,
  propertyTaxBps: 110,
  annualInsuranceCents: 200_000,
  insuranceGrowthBps: 300,
  monthlyHoaCents: 0,
  hoaGrowthBps: 300,
  maintenanceBps: 100,
  monthlyRentalIncomeCents: 0,
  rentalIncomeGrowthBps: 300,
  factorRentalTaxes: false,
  propertyTaxBasisOverrideCents: null,
  buildingBasisOverrideCents: null,
  mfsLivedApartAllYear: false,
  rentalType: "long-term",
  shortTermMaterialParticipation: false,
  longTermRealEstateProfessional: false,
  longTermMaterialParticipation: false,
};
export const calculatedPropertyTaxBasis = (a: InvestmentAssumptions) =>
  Math.round(a.homePriceCents * (1 + a.purchaseCostBps / 10_000));
export const effectivePropertyTaxBasis = (a: InvestmentAssumptions) =>
  a.propertyTaxBasisOverrideCents ?? calculatedPropertyTaxBasis(a);
export const effectiveBuildingBasis = (a: InvestmentAssumptions) =>
  a.buildingBasisOverrideCents ??
  Math.round(effectivePropertyTaxBasis(a) * 0.8);
const safe = (n: number) =>
  Number.isSafeInteger(n) && n >= 0 && n <= 99_999_999_999_999;
export function validateInvestmentAssumptions(
  a: InvestmentAssumptions,
): InvestmentValidationError[] {
  const errors: InvestmentValidationError[] = [];
  if (a.retirementIncomeMode !== "current" && a.retirementIncomeMode !== "desired")
    errors.push({ field: "retirementIncomeMode", message: "Choose a valid retirement income mode." });
  if (!safe(a.annualRetirementIncomeCents))
    errors.push({ field: "annualRetirementIncomeCents", message: "Enter a valid non-negative annual amount." });
  if (!Number.isInteger(a.fireWithdrawalRateBps) || a.fireWithdrawalRateBps < 1 || a.fireWithdrawalRateBps > 10_000)
    errors.push({ field: "fireWithdrawalRateBps", message: "FIRE withdrawal rate must be greater than 0% and no more than 100%." });
  const needsRentalShare = a.primaryResidence && (a.monthlyRentalIncomeCents > 0 || (a.aduPlanned && a.aduMonthlyRentCents > 0));
  if (!Number.isInteger(a.rentalUseBps) || (needsRentalShare ? a.rentalUseBps < 100 || a.rentalUseBps > 9900 : a.rentalUseBps !== 0))
    errors.push({ field: "rentalUseBps", message: needsRentalShare ? "Rental use must be from 1% to 99%." : "Rental use must be zero unless a primary residence has tenant income." });
  if (a.rentalType !== "long-term" && a.rentalType !== "short-term")
    errors.push({ field: "rentalType", message: "Choose a valid rental type." });
  const money: (keyof InvestmentAssumptions)[] = [
    "homePriceCents",
    "aduBuildCostCents",
    "aduMonthlyRentCents",
    "monthlyRentCents",
    "annualInsuranceCents",
    "monthlyHoaCents",
    "monthlyRentalIncomeCents",
  ];
  money.forEach((field) => {
    if (!safe(a[field] as number))
      errors.push({ field, message: "Enter a valid non-negative amount." });
  });
  if (a.homePriceCents <= 0)
    errors.push({
      field: "homePriceCents",
      message: "Home price must be greater than zero.",
    });
  if (!Number.isInteger(a.homeSquareFeet) || a.homeSquareFeet < 1)
    errors.push({ field: "homeSquareFeet", message: "Home square footage must be greater than zero." });
  if (!Number.isInteger(a.aduSquareFeet) || a.aduSquareFeet < 0 || (a.aduPlanned && a.aduSquareFeet < 1))
    errors.push({ field: "aduSquareFeet", message: "ADU square footage must be greater than zero when an ADU is planned." });
  if (!Number.isInteger(a.aduBuildYear) || a.aduBuildYear < 1 || (a.aduPlanned && a.aduBuildYear > a.horizonYears))
    errors.push({ field: "aduBuildYear", message: "ADU build year must fall within the projection horizon." });
  const rates: (keyof InvestmentAssumptions)[] = [
    "mortgageRateBps",
    "stockReturnBps",
    "homeAppreciationBps",
    "purchaseCostBps",
    "sellingCostBps",
    "rentGrowthBps",
    "propertyTaxBps",
    "insuranceGrowthBps",
    "hoaGrowthBps",
    "maintenanceBps",
    "rentalIncomeGrowthBps",
  ];
  rates.forEach((field) => {
    const n = a[field] as number;
    if (!Number.isFinite(n) || n < 0 || n > 10_000)
      errors.push({ field, message: "Enter a percentage from 0% to 100%." });
  });
  if (
    !Number.isFinite(a.downPaymentBps) ||
    a.downPaymentBps < 0 ||
    a.downPaymentBps >= 10_000
  )
    errors.push({
      field: "downPaymentBps",
      message: "Down payment must be from 0% to less than 100%.",
    });
  if (
    !Number.isInteger(a.mortgageTermYears) ||
    a.mortgageTermYears < 1 ||
    a.mortgageTermYears > 50
  )
    errors.push({
      field: "mortgageTermYears",
      message: "Mortgage term must be 1 to 50 years.",
    });
  if (
    !Number.isInteger(a.horizonYears) ||
    a.horizonYears < 1 ||
    a.horizonYears > 50
  )
    errors.push({
      field: "horizonYears",
      message: "Projection horizon must be 1 to 50 years.",
    });
  for (const field of [
    "propertyTaxBasisOverrideCents",
    "buildingBasisOverrideCents",
  ] as const)
    if (a[field] !== null && !safe(a[field]!))
      errors.push({
        field,
        message: "Enter a valid non-negative basis, or use calculated basis.",
      });
  if (effectiveBuildingBasis(a) > effectivePropertyTaxBasis(a))
    errors.push({
      field: "buildingBasisOverrideCents",
      message: "Building basis cannot exceed total property tax basis.",
    });
  return errors;
}
export function mortgagePayment(
  principal: number,
  annualRateBps: number,
  months: number,
) {
  if (principal <= 0) return 0;
  const rate = annualRateBps / 120_000;
  return rate === 0
    ? principal / months
    : (principal * rate) / (1 - Math.pow(1 + rate, -months));
}
const progressive = (income: number, brackets: readonly TaxBracket[]) => {
  let tax = 0,
    lower = 0;
  for (const b of brackets) {
    const upper = b.upToCents ?? income,
      tier = Math.max(0, Math.min(income, upper) - lower);
    tax += (tier * b.rateBps) / 10_000;
    if (income <= upper) break;
    lower = upper;
  }
  return Math.round(tax);
};
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number),
    d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export function depreciationForMonth(
  buildingBasis: number,
  placedMonth: number,
  monthIndex: number,
) {
  const life = 27.5 * 12;
  if (monthIndex < 1 || monthIndex > life + 1) return 0;
  if (monthIndex === 1) return (buildingBasis / life) * 0.5;
  if (monthIndex === life + 1) return (buildingBasis / life) * 0.5;
  return buildingBasis / life;
}
function allowance(
  loss: number,
  magi: number,
  status: FilingStatus,
  livedApart: boolean,
  california = false,
) {
  if (loss <= 0) return 0;
  if (status === "married-separate" && !livedApart) return 0;
  const base = status === "married-separate" ? 12_500_00 : 25_000_00,
    start = status === "married-separate" ? 50_000_00 : 100_000_00,
    end = status === "married-separate" ? 75_000_00 : 150_000_00;
  const phase =
    magi <= start
      ? base
      : magi >= end
        ? 0
        : Math.round((base * (end - magi)) / (end - start));
  return Math.min(loss, phase, california ? base : base);
}
const crossover = (
  months: InvestmentMonth[],
  get: (m: InvestmentMonth) => number,
) => {
  const out: InvestmentCrossover[] = [];
  let prior = Math.sign(months[0].stockValueCents - get(months[0]));
  for (const m of months.slice(1)) {
    const sign = Math.sign(m.stockValueCents - get(m));
    if (sign && prior && sign !== prior)
      out.push({
        month: m.month,
        year: Math.ceil(m.month / 12),
        leader: sign > 0 ? "rent-invest" : "buy",
      });
    if (sign) prior = sign;
  }
  return out;
};
function contextFor(
  ctx: InvestmentTaxContext,
  year: number,
): InvestmentTaxYearContext {
  const exact = ctx.years.find((x) => x.year === year);
  if (exact) return exact;
  const last = ctx.years.at(-1)!;
  const factor = Math.pow(
    1 + ctx.thresholdInflationBps / 10_000,
    year - last.year,
  );
  return {
    ...last,
    year,
    federalTaxableCents: Math.round(last.federalTaxableCents * factor),
    californiaTaxableCents: Math.round(last.californiaTaxableCents * factor),
    modifiedAgiCents: Math.round(last.modifiedAgiCents * factor),
  };
}
export function calculateInvestmentComparison(
  a: InvestmentAssumptions,
  taxContext?: InvestmentTaxContext,
): InvestmentCalculation {
  const errors = validateInvestmentAssumptions(a);
  if (a.factorRentalTaxes && (!taxContext || !taxContext.years.length))
    errors.push({
      field: "taxContext",
      message:
        "Complete the household tax profile and active Plan scenario before factoring rental taxes.",
    });
  if (errors.length) return { ok: false, errors };
  const start =
      taxContext?.startMonth ??
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    loan = a.homePriceCents * (1 - a.downPaymentBps / 10_000),
    term = a.mortgageTermYears * 12,
    payment = mortgagePayment(loan, a.mortgageRateBps, term),
    stockMonthly = a.stockReturnBps / 120_000,
    homeMonthly = a.homeAppreciationBps / 120_000;
  let stock =
      (a.homePriceCents * (a.downPaymentBps + a.purchaseCostBps)) / 10_000,
    home = a.homePriceCents,
    baseHome = a.homePriceCents,
    assessedValue = a.propertyTaxBasisOverrideCents ?? a.homePriceCents,
    balance = loan,
    portfolio = 0,
    accumDep = 0,
    fedCarry = 0,
    caCarry = 0;
  const stockLots: StockLot[]=[{value:stock,basis:stock,acquiredMonth:0}], portfolioLots: StockLot[]=[], annualLots:{stock:StockLot[];portfolio:StockLot[]}[]=[];
  const zero = {
    rentalIncomeCents: 0,
    principalCents: 0,
    interestCents: 0,
    ownerOutlayCents: 0,
    rentCents: 0,
    stockContributionCents: 0,
    deductibleOperatingExpensesCents: 0,
    depreciationCents: 0,
    accumulatedDepreciationCents: 0,
    federalAllowedRentalCents: 0,
    californiaAllowedRentalCents: 0,
    federalPassiveCarryforwardCents: 0,
    californiaPassiveCarryforwardCents: 0,
    baselineTaxCents: 0,
    buyTaxCents: 0,
    netTaxDeltaCents: 0,
    taxAdjustedBuyContributionCents: 0,
  };
  const initialSale = home * (1 - a.sellingCostBps / 10_000) - balance,
    months: InvestmentMonth[] = [
      {
        month: 0,
        stockValueCents: Math.round(stock),
        homeValueCents: home,
        mortgageBalanceCents: Math.round(balance),
        equityCents: Math.round(home - balance),
        saleProceedsCents: Math.round(initialSale),
        rentalPortfolioCents: 0,
        buyRetainedTotalCents: Math.round(home - balance),
        buySaleTotalCents: Math.round(initialSale),
        ...zero,
      },
    ];
  const raw: {
    month: number;
    year: number;
    income: number;
    interest: number;
    operating: number;
    depreciation: number;
    owner: number;
    rent: number;
    principal: number;
    home: number;
    balance: number;
  }[] = [];
  for (let month = 1; month <= a.horizonYears * 12; month++) {
    baseHome *= 1 + homeMonthly;
    home *= 1 + homeMonthly;
    assessedValue *= Math.pow(1.02,1/12);
    const aduBuildMonth = (a.aduBuildYear - 1) * 12 + 1,
      buildsAdu = a.aduPlanned && month === aduBuildMonth;
    if (buildsAdu) {
      const aduAddedValue=baseHome / a.homeSquareFeet * a.aduSquareFeet;
      home += aduAddedValue;
      assessedValue += aduAddedValue;
    }
    const interest =
        month <= term ? (balance * a.mortgageRateBps) / 120_000 : 0,
      principal = month <= term ? Math.min(balance, payment - interest) : 0;
    balance = Math.max(0, balance - principal);
    const elapsed = month - 1,
      tax = (assessedValue * a.propertyTaxBps) / 120_000,
      maintenance = (home * a.maintenanceBps) / 120_000,
      insurance =
        (a.annualInsuranceCents *
          Math.pow(1 + a.insuranceGrowthBps / 120_000, elapsed)) /
        12,
      hoa = a.monthlyHoaCents * Math.pow(1 + a.hoaGrowthBps / 120_000, elapsed),
      income =
        a.monthlyRentalIncomeCents *
        Math.pow(1 + a.rentalIncomeGrowthBps / 120_000, elapsed) +
        (a.aduPlanned && month >= aduBuildMonth
          ? a.aduMonthlyRentCents * Math.pow(1 + a.rentalIncomeGrowthBps / 120_000, month - aduBuildMonth)
          : 0),
      rent =
        a.monthlyRentCents * Math.pow(1 + a.rentGrowthBps / 120_000, elapsed),
      rentalShare = a.primaryResidence ? a.rentalUseBps / 10_000 : 1,
      operating = (tax + maintenance + insurance + hoa) * rentalShare,
      owner = principal + interest + operating + (buildsAdu ? a.aduBuildCostCents : 0),
      year = Number(addMonths(start, elapsed).slice(0, 4)),
      depreciation = a.factorRentalTaxes
        ? depreciationForMonth(
            effectiveBuildingBasis(a) * rentalShare,
            Number(start.slice(5)),
            month,
          )
        : 0;
    raw.push({
      month,
      year,
      income,
      interest,
      operating,
      depreciation,
      owner,
      rent,
      principal,
      home,
      balance,
    });
  }
  const adjustments = new Map<
    number,
    {
      fedAllowed: number;
      caAllowed: number;
      fedCarry: number;
      caCarry: number;
      base: number;
      buy: number;
      delta: number;
    }
  >();
  for (const year of [...new Set(raw.map((x) => x.year))]) {
    const rows = raw.filter((x) => x.year === year),
      income = rows.reduce((s, x) => s + x.income, 0),
      deductions = rows.reduce(
        (s, x) => s + x.interest + x.operating + x.depreciation,
        0,
      ),
      net = Math.round(income - deductions);
    let fedAllowed = net,
      caAllowed = net;
    const ctx = taxContext && contextFor(taxContext, year);
    if (a.factorRentalTaxes && ctx) {
      const nonPassiveShortTerm =
        a.rentalType === "short-term" && a.shortTermMaterialParticipation;
      const nonPassiveLongTerm =
        a.rentalType === "long-term" &&
        a.longTermRealEstateProfessional &&
        a.longTermMaterialParticipation;
      if (net < 0 && (nonPassiveShortTerm || nonPassiveLongTerm)) {
        fedAllowed = net;
        caAllowed = net;
      } else if (net < 0) {
        const fed = allowance(
            -net,
            ctx.modifiedAgiCents,
            taxContext!.filingStatus,
            a.mfsLivedApartAllYear,
          ),
          ca = allowance(
            -net,
            ctx.modifiedAgiCents,
            taxContext!.filingStatus,
            a.mfsLivedApartAllYear,
            true,
          );
        fedAllowed = -fed;
        caAllowed = -ca;
        fedCarry += -net - fed;
        caCarry += -net - ca;
      } else {
        const fedUse = Math.min(net, fedCarry),
          caUse = Math.min(net, caCarry);
        fedCarry -= fedUse;
        caCarry -= caUse;
        fedAllowed = net - fedUse;
        caAllowed = net - caUse;
      }
      const pack = projectedTaxRules(year, taxContext.thresholdInflationBps),
        base = ctx.federalTaxCents + ctx.californiaTaxCents,
        buy =
          progressive(
            Math.max(0, ctx.federalTaxableCents + fedAllowed),
            pack.federal[taxContext.filingStatus].brackets,
          ) +
          progressive(
            Math.max(0, ctx.californiaTaxableCents + caAllowed),
            pack.california[taxContext.filingStatus].brackets,
          );
      adjustments.set(year, {
        fedAllowed,
        caAllowed,
        fedCarry,
        caCarry,
        base,
        buy,
        delta: base - buy,
      });
    } else
      adjustments.set(year, {
        fedAllowed: net,
        caAllowed: net,
        fedCarry: 0,
        caCarry: 0,
        base: 0,
        buy: 0,
        delta: 0,
      });
  }
  for (const row of raw) {
    stock *= 1 + stockMonthly;
    portfolio *= 1 + stockMonthly;
    stockLots.forEach(l=>l.value*=1+stockMonthly);
    portfolioLots.forEach(l=>l.value*=1+stockMonthly);
    const adj = adjustments.get(row.year)!,
      yearRows = raw.filter((x) => x.year === row.year),
      weight = yearRows.reduce((s, x) => s + x.income, 0),
      share = weight ? row.income / weight : 1 / yearRows.length,
      taxDelta = Math.round(adj.delta * share),
      buyContribution = row.income + taxDelta;
    stock += row.owner;
    portfolio += buyContribution;
    applyLotFlow(stockLots,row.owner,row.month);
    applyLotFlow(portfolioLots,buyContribution,row.month);
    accumDep += row.depreciation;
    const equity = row.home - row.balance,
      preTaxSale = row.home * (1 - a.sellingCostBps / 10_000) - row.balance;
    let sale = preTaxSale;
    if (a.factorRentalTaxes && taxContext) {
      const held = row.month,
        rawGain =
          row.home * (1 - a.sellingCostBps / 10_000) -
          (effectivePropertyTaxBasis(a) - accumDep),
        exclusion = a.primaryResidence && held >= 24
          ? Math.min(Math.max(0, rawGain - accumDep), taxContext.filingStatus === "married-joint" ? 50_000_000 : 25_000_000)
          : 0,
        gain = rawGain - exclusion,
        ctx = contextFor(taxContext, row.year),
        pack = projectedTaxRules(row.year, taxContext.thresholdInflationBps);
      let federal = 0,
        california = 0;
      if (gain < 0) {
        federal =
          progressive(
            ctx.federalTaxableCents + gain,
            pack.federal[taxContext.filingStatus].brackets,
          ) - ctx.federalTaxCents;
        california =
          progressive(
            ctx.californiaTaxableCents + gain,
            pack.california[taxContext.filingStatus].brackets,
          ) - ctx.californiaTaxCents;
      } else if (held <= 12) {
        const federalDispositionIncome = gain - fedCarry;
        const californiaDispositionIncome = gain - caCarry;
        federal =
          progressive(
            Math.max(0, ctx.federalTaxableCents + federalDispositionIncome),
            pack.federal[taxContext.filingStatus].brackets,
          ) - ctx.federalTaxCents;
        california =
          progressive(
            Math.max(
              0,
              ctx.californiaTaxableCents + californiaDispositionIncome,
            ),
            pack.california[taxContext.filingStatus].brackets,
          ) - ctx.californiaTaxCents;
      } else {
        const federalGain = Math.max(0, gain - fedCarry),
          californiaGain = Math.max(0, gain - caCarry),
          recapture = Math.min(federalGain, accumDep),
          ltcg = federalGain - recapture,
          capitalBefore = progressive(
            ctx.federalTaxableCents,
            pack.federalLongTermCapitalGains[taxContext.filingStatus],
          ),
          capitalAfter = progressive(
            ctx.federalTaxableCents + ltcg,
            pack.federalLongTermCapitalGains[taxContext.filingStatus],
          ),
          niitBase = Math.min(
            federalGain,
            Math.max(
              0,
              ctx.modifiedAgiCents +
                federalGain -
                pack.netInvestmentIncomeThresholdCents[
                  taxContext.filingStatus
                ],
            ),
          );
        federal = Math.round(
          (recapture * pack.unrecapturedSection1250MaxRateBps) / 10_000 +
            (capitalAfter - capitalBefore) +
            niitBase * 0.038,
        );
        california =
          progressive(
            ctx.californiaTaxableCents + californiaGain,
            pack.california[taxContext.filingStatus].brackets,
          ) - ctx.californiaTaxCents;
      }
      sale -= Math.max(0, federal + california);
    }
    months.push({
      month: row.month,
      stockValueCents: Math.round(stock),
      homeValueCents: Math.round(row.home),
      mortgageBalanceCents: Math.round(row.balance),
      equityCents: Math.round(equity),
      saleProceedsCents: Math.round(sale),
      rentalPortfolioCents: Math.round(portfolio),
      buyRetainedTotalCents: Math.round(equity + portfolio),
      buySaleTotalCents: Math.round(sale + portfolio),
      rentalIncomeCents: Math.round(row.income),
      principalCents: Math.round(row.principal),
      interestCents: Math.round(row.interest),
      ownerOutlayCents: Math.round(row.owner),
      rentCents: Math.round(row.rent),
      stockContributionCents: Math.round(row.owner),
      deductibleOperatingExpensesCents: Math.round(row.operating),
      depreciationCents: Math.round(row.depreciation),
      accumulatedDepreciationCents: Math.round(accumDep),
      federalAllowedRentalCents: Math.round(adj.fedAllowed * share),
      californiaAllowedRentalCents: Math.round(adj.caAllowed * share),
      federalPassiveCarryforwardCents: adj.fedCarry,
      californiaPassiveCarryforwardCents: adj.caCarry,
      baselineTaxCents: Math.round(adj.base * share),
      buyTaxCents: Math.round(adj.buy * share),
      netTaxDeltaCents: taxDelta,
      taxAdjustedBuyContributionCents: Math.round(buyContribution),
    });
    if(row.month%12===0)annualLots.push({stock:stockLots.map(x=>({...x})),portfolio:portfolioLots.map(x=>({...x}))});
  }
  const years: InvestmentYear[] = [];
  for (let i = 0; i < a.horizonYears; i++) {
    const slice = months.slice(i * 12 + 1, i * 12 + 13),
      end = slice.at(-1)!;
    const sum = (key: keyof InvestmentMonth) =>
      slice.reduce((s, m) => s + (m[key] as number), 0);
    years.push({
      ...end,
      year: i + 1,
      calendarYear: Number(addMonths(start, i * 12).slice(0, 4)),
      rentalIncomeCents: sum("rentalIncomeCents"),
      principalCents: sum("principalCents"),
      interestCents: sum("interestCents"),
      ownerOutlayCents: sum("ownerOutlayCents"),
      rentCents: sum("rentCents"),
      stockContributionCents: sum("stockContributionCents"),
      deductibleOperatingExpensesCents: sum("deductibleOperatingExpensesCents"),
      depreciationCents: sum("depreciationCents"),
      federalAllowedRentalCents: sum("federalAllowedRentalCents"),
      californiaAllowedRentalCents: sum("californiaAllowedRentalCents"),
      baselineTaxCents: sum("baselineTaxCents"),
      buyTaxCents: sum("buyTaxCents"),
      netTaxDeltaCents: sum("netTaxDeltaCents"),
      taxAdjustedBuyContributionCents: sum("taxAdjustedBuyContributionCents"),
    });
  }
  const retirementYears = years.map((year): RetirementYearResult => {
    const inflationFactor = Math.pow(1 + (taxContext?.thresholdInflationBps ?? 0) / 10_000, year.year);
    const ctx = taxContext && contextFor(taxContext, year.calendarYear);
    const pack = taxContext && projectedTaxRules(year.calendarYear, taxContext.thresholdInflationBps);
    const otherNominal = a.annualRetirementIncomeCents * inflationFactor;
    const targetNominal = a.retirementIncomeMode === "desired" ? otherNominal : null;
    const ordinaryTax = (ordinary: number, shortGain: number, longGain = 0) => {
      if (!ctx || !pack || !taxContext) return 0;
      const fedOrdinary = progressive(Math.max(0, ctx.federalTaxableCents + ordinary + shortGain), pack.federal[taxContext.filingStatus].brackets) - ctx.federalTaxCents;
      const fedCapital = progressive(ctx.federalTaxableCents + ordinary + shortGain + longGain, pack.federalLongTermCapitalGains[taxContext.filingStatus]) - progressive(ctx.federalTaxableCents + ordinary + shortGain, pack.federalLongTermCapitalGains[taxContext.filingStatus]);
      const gains=shortGain+longGain, ca = progressive(Math.max(0, ctx.californiaTaxableCents + ordinary + gains), pack.california[taxContext.filingStatus].brackets) - ctx.californiaTaxCents;
      const niit = Math.min(gains, Math.max(0, ctx.modifiedAgiCents + ordinary + gains - pack.netInvestmentIncomeThresholdCents[taxContext.filingStatus])) * 0.038;
      return Math.max(0, Math.round(fedOrdinary + fedCapital + ca + niit));
    };
    const make = (path: RetirementPath, wealth: number, stockPool: number, lots: readonly StockLot[], rentalCash = 0): RetirementPathResult => {
      const cap = Math.max(0, stockPool * a.fireWithdrawalRateBps / 10_000);
      const baseOtherTax = a.retirementIncomeMode === "current" ? ordinaryTax(otherNominal, 0, 0) : 0;
      const netFor = (gross: number) => {
        const gains=sellLotsFifo(lots,gross,year.year*12);
        const combinedTax = ordinaryTax(a.retirementIncomeMode === "current" ? otherNominal : 0, gains.short, gains.long);
        const tax = Math.max(0, combinedTax - baseOtherTax);
        return { ...gains, tax, net: gross + rentalCash - tax };
      };
      let gross = cap;
      if (targetNominal !== null) {
        let lo = 0, hi = cap;
        for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (netFor(mid).net >= targetNominal) hi = mid; else lo = mid; }
        gross = netFor(hi).net >= targetNominal ? hi : cap;
      }
      const calc = netFor(gross), investmentNominal = calc.net;
      const otherAfterTax = a.retirementIncomeMode === "current" ? otherNominal - baseOtherTax : 0;
      const totalNominal = investmentNominal + otherAfterTax;
      const target = targetNominal ?? 0;
      let required = 0;
      if (targetNominal !== null && netFor(cap).net < target) {
        let lo = stockPool, hi = Math.max(stockPool, target * 100_000 / a.fireWithdrawalRateBps);
        for (let i = 0; i < 40; i++) { const mid=(lo+hi)/2; if (netFor(mid*a.fireWithdrawalRateBps/10_000).net >= target) hi=mid; else lo=mid; }
        required = hi;
      } else if (targetNominal !== null) required = gross * 10_000 / a.fireWithdrawalRateBps;
      return {
        path, wealthCents: Math.round(wealth), grossStockWithdrawalCents: Math.round(gross / inflationFactor),
        realizedShortTermGainCents: Math.round(calc.short / inflationFactor), realizedLongTermGainCents: Math.round(calc.long / inflationFactor),
        propertyGrossRentCents: Math.round((path === "keep" ? year.rentalIncomeCents : 0) / inflationFactor),
        propertyCashCostsCents: Math.round((path === "keep" ? year.deductibleOperatingExpensesCents + (year.principalCents + year.interestCents) * (a.primaryResidence ? a.rentalUseBps / 10_000 : 1) : 0) / inflationFactor),
        incrementalTaxCents: Math.round(calc.tax / inflationFactor), afterTaxInvestmentIncomeCents: Math.round(investmentNominal / inflationFactor),
        totalAfterTaxIncomeCents: Math.round(totalNominal / inflationFactor), effectiveYieldBps: wealth > 0 ? Math.round(investmentNominal * 10_000 / wealth) : 0,
        targetCoverageBps: targetNominal === null ? null : target ? Math.round(Math.min(1, totalNominal / target) * 10_000) : 10_000,
        shortfallCents: Math.round(Math.max(0, target - totalNominal) / inflationFactor), requiredStockValueCents: Math.round(required / inflationFactor),
        additionalStockValueCents: Math.round(Math.max(0, required - stockPool) / inflationFactor),
      };
    };
    const rentalShare = a.primaryResidence ? a.rentalUseBps / 10_000 : 1;
    const rentalCash = year.rentalIncomeCents - year.deductibleOperatingExpensesCents - (year.principalCents + year.interestCents) * rentalShare + year.netTaxDeltaCents;
    return { year: year.year, calendarYear: year.calendarYear, retirementMonth: year.year * 12, inflationFactor,
      targetCents: targetNominal === null ? null : a.annualRetirementIncomeCents,
      paths: {
        stocks: make("stocks", year.stockValueCents, year.stockValueCents, annualLots[year.year-1].stock),
        keep: make("keep", year.buyRetainedTotalCents, year.rentalPortfolioCents, annualLots[year.year-1].portfolio, rentalCash),
        sell: make("sell", year.buySaleTotalCents, year.buySaleTotalCents, [...annualLots[year.year-1].portfolio,{value:year.saleProceedsCents,basis:year.saleProceedsCents,acquiredMonth:year.year*12}]),
      }};
  });
  return {
    ok: true,
    result: {
      months,
      years,
      equityCrossovers: crossover(months, (m) => m.buyRetainedTotalCents),
      saleCrossovers: crossover(months, (m) => m.buySaleTotalCents),
      taxRuleYears: [...new Set(raw.map((x) => x.year))],
      retirementYears,
    },
  };
}
