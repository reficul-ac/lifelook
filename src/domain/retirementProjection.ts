import { projectGrowth, ProjectionEngine } from "./projection";
import { buildRetirementCutoff } from "./retirementCutoff";
import { progressiveTax, projectedTaxRules } from "./tax";
import {
  calculateRetirementSnapshot,
  resolveRetirementHomeSales,
  type RetirementMissingData,
  type RetirementSnapshotResult,
  type SellHomesResult,
} from "./retirementSnapshot";
import {
  isTaxableInvestmentAccount,
  type NormalizedRetirementSettings,
} from "./retirementSettings";
import {
  ageOnDate,
  drawRetirementFunds,
  resolveRetirementAccountOrder,
  type RetirementDrawSource,
} from "./retirementWithdrawals";
import type { BasisPoints, Cents, FinancialSnapshot, Scenario } from "./types";

export interface RetirementProjectionInput {
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  asOfDate: string;
  settings: NormalizedRetirementSettings;
}

export interface RetirementProjectionWarning {
  code: "missing-destination" | "missing-home-data" | "early-withdrawal" |
    "account-depleted" | "unfunded-spending" | "activity-ended" | "calculation-error";
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
  earlyPenaltyCents: Cents;
  afterTaxIncomeCents: Cents;
  planExpenseCents: Cents;
  housingExpenseCents: Cents;
  surplusCents: Cents;
  shortfallCents: Cents;
  destinationBalanceCents: Cents;
  endingNetWorthCents: Cents;
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
}

export interface UnavailableRetirementScenarioProjection {
  available: false;
  issues: readonly RetirementMissingData[];
  warnings: readonly RetirementProjectionWarning[];
}

export interface RetirementProjectionResult {
  retirementMonth: string;
  withdrawalRateBps: BasisPoints;
  netWorthCents: Cents;
  keepHomes: AvailableRetirementScenarioProjection<RetirementSnapshotResult["keepHomes"]>;
  sellHomes: AvailableRetirementScenarioProjection<Extract<SellHomesResult, { available: true }>> |
    UnavailableRetirementScenarioProjection;
  effectiveWithdrawalOrder: readonly string[];
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

const monthsInclusive = (start: string, end: string) => {
  const from = parseMonth(start);
  const to = parseMonth(end);
  return (to.year - from.year) * 12 + to.month - from.month + 1;
};

export const extendScenarioHorizon = (
  scenario: Scenario,
  retirementMonth: string,
  horizonYears: number,
): Scenario => {
  if (!Number.isInteger(horizonYears) || horizonYears < 1 || horizonYears > 60) {
    throw new RangeError("horizonYears must be an integer from 1 to 60");
  }
  const finalRetirementMonth = addMonths(retirementMonth, horizonYears * 12 - 1);
  const months = monthsInclusive(scenario.horizon.start, finalRetirementMonth);
  if (months < 1) throw new RangeError("Retirement horizon cannot end before the scenario starts");
  return {
    ...scenario,
    horizon: { start: scenario.horizon.start, months },
    retirementExtension: true,
  } as Scenario & { retirementExtension: true };
};

interface RetirementYearState {
  accounts: Record<string, Cents>;
  assets: Record<string, Cents>;
  liabilities: Record<string, Cents>;
  taxableBasis: Record<string, Cents>;
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
}

const sumRecord = (values: Readonly<Record<string, Cents>>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0);

const homeEquity = (
  state: RetirementYearState,
  homes: readonly { assetId: string; liabilityId?: string }[],
) => homes.reduce((sum, home) =>
  sum + (state.assets[home.assetId] ?? 0) -
  (home.liabilityId == null ? 0 : state.liabilities[home.liabilityId] ?? 0), 0);

const portfolioValue = (
  state: RetirementYearState,
  homes: readonly { assetId: string; liabilityId?: string }[],
) => Math.max(
  0,
  sumRecord(state.accounts) + sumRecord(state.assets) - sumRecord(state.liabilities) -
    homeEquity(state, homes),
);

const calculateIncomeTax = (
  input: RetirementProjectionInput,
  year: number,
  ordinaryIncomeCents: Cents,
  taxableGainCents: Cents,
  housing: RetirementProjectionYear["housing"],
) => {
  const pack = projectedTaxRules(year, input.scenario.assumptions.thresholdInflationBps);
  const status = input.snapshot.taxProfile.filingStatus;
  const federalItemized = housing.interestCents + housing.propertyTaxCents;
  const californiaItemized = federalItemized;
  const federalDeduction = Math.max(
    pack.federal[status].standardDeductionCents,
    federalItemized,
  );
  const californiaDeduction = Math.max(
    pack.california[status].standardDeductionCents,
    californiaItemized,
  );
  const federalOrdinaryTaxable = Math.max(0, ordinaryIncomeCents - federalDeduction);
  const federalTotalTaxable = Math.max(
    0,
    ordinaryIncomeCents + taxableGainCents - federalDeduction,
  );
  const federalGainTaxable = Math.max(0, federalTotalTaxable - federalOrdinaryTaxable);
  const federalOrdinaryTax = progressiveTax(
    federalOrdinaryTaxable,
    pack.federal[status].brackets,
  );
  const federalGainTax = progressiveTax(
    federalOrdinaryTaxable + federalGainTaxable,
    pack.federalLongTermCapitalGains[status],
  ) - progressiveTax(federalOrdinaryTaxable, pack.federalLongTermCapitalGains[status]);
  const californiaTaxable = Math.max(
    0,
    ordinaryIncomeCents + taxableGainCents - californiaDeduction,
  );
  const californiaTax = progressiveTax(californiaTaxable, pack.california[status].brackets);
  const investmentIncomeCents = Math.max(0, taxableGainCents);
  const niitBaseCents = Math.min(
    investmentIncomeCents,
    Math.max(
      0,
      ordinaryIncomeCents + investmentIncomeCents -
        pack.netInvestmentIncomeThresholdCents[status],
    ),
  );
  return federalOrdinaryTax + federalGainTax + californiaTax +
    Math.round(niitBaseCents * 380 / 10_000);
};

const initialState = (
  input: RetirementProjectionInput,
  cutoff: ReturnType<typeof buildRetirementCutoff>,
): RetirementYearState => {
  const taxableBasis: Record<string, Cents> = {};
  const rothContributionBasis: Record<string, Cents> = {};
  for (const account of input.snapshot.accounts) {
    const balance = Math.max(0, cutoff.accounts[account.id] ?? 0);
    if (account.subtype === "taxable-brokerage" ||
      account.subtype == null && account.kind === "investment") {
      const recordedBasis = account.taxableCostBasisCents ??
        account.taxLots?.reduce((sum, lot) => sum + lot.federalBasisCents, 0) ?? 0;
      taxableBasis[account.id] = Math.min(balance, Math.max(0, recordedBasis));
    }
    if (account.subtype === "roth-ira" || account.subtype === "employer-roth") {
      rothContributionBasis[account.id] = Math.min(
        balance,
        Math.max(0, account.rothContributionBasisCents ?? 0),
      );
    }
  }
  return {
    accounts: { ...cutoff.accounts },
    assets: { ...cutoff.assets },
    liabilities: { ...cutoff.liabilities },
    taxableBasis,
    rothContributionBasis,
  };
};

const combineSources = (
  sources: readonly RetirementDrawSource[],
  more: readonly RetirementDrawSource[],
) => [...sources, ...more];

const sumSources = (
  sources: readonly RetirementDrawSource[],
  key: "taxableGainCents" | "ordinaryIncomeCents" | "rothTaxableCents" |
    "earlyPenaltyCents",
) => sources.reduce((sum, source) => sum + source[key], 0);

const calculationErrorYear = (
  input: RetirementProjectionInput,
  periodStart: string,
  message: string,
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
    earlyPenaltyCents: 0,
    afterTaxIncomeCents: 0,
    planExpenseCents: 0,
    housingExpenseCents: 0,
    surplusCents: 0,
    shortfallCents: 0,
    destinationBalanceCents: 0,
    endingNetWorthCents: 0,
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
    warnings: [{ code: "calculation-error", year, message }],
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
  initialOrder: readonly string[],
  homeSale?: RetirementHomeSaleRollForward,
): readonly RetirementProjectionYear[] => {
  let state = initialState(input, cutoff);
  let calculationFailure: string | undefined;
  const cutoffHomes = cutoff.properties.map((property) => ({
    assetId: property.assetId,
    liabilityId: property.liabilityId,
  }));
  const homes = homeSale == null ? cutoffHomes : [];
  const selectedDestination = input.settings.taxableDestinationAccountId == null
    ? undefined
    : input.snapshot.accounts.find((account) =>
      account.id === input.settings.taxableDestinationAccountId &&
      isTaxableInvestmentAccount(account));
  const destinationId = selectedDestination?.id;
  if (homeSale != null) {
    for (const assetId of homeSale.assetIds) delete state.assets[assetId];
    for (const liabilityId of homeSale.liabilityIds) delete state.liabilities[liabilityId];
    if (destinationId != null && state.accounts[destinationId] != null) {
      state.accounts[destinationId] += homeSale.netProceedsCents;
      state.taxableBasis[destinationId] = (state.taxableBasis[destinationId] ?? 0) +
        homeSale.netProceedsCents;
    }
  }
  const monthsByKey = new Map(planMonths.map((month) => [month.month, month]));
  const accountById = new Map(input.snapshot.accounts.map((account) => [account.id, account]));

  return Array.from({ length: input.settings.horizonYears }, (_, index) => {
    const periodStart = addMonths(input.settings.retirementMonth, index * 12);
    if (calculationFailure != null) {
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    const periodMonths = Array.from({ length: 12 }, (__, monthIndex) =>
      monthsByKey.get(addMonths(periodStart, monthIndex))).filter((month) => month != null);
    const year = Number(periodStart.slice(0, 4));
    if (periodMonths.length !== 12) {
      calculationFailure = `Missing monthly Plan data for retirement year ${year}.`;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    const openingStateError = invalidStateMessage(state);
    if (openingStateError != null) {
      calculationFailure = openingStateError;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    const startingPortfolioCents = portfolioValue(state, homes);
    const withdrawalTargetCents = Math.round(
      startingPortfolioCents * input.settings.withdrawalRateBps / 10_000,
    );

    for (let monthIndex = 0; monthIndex < periodMonths.length; monthIndex++) {
      for (const [accountId, balance] of Object.entries(state.accounts)) {
        const account = accountById.get(accountId);
        if (account) state.accounts[accountId] = projectGrowth(balance, account.annualReturnBps, 1);
      }
    }
    const accountReturnStateError = invalidStateMessage(state);
    if (accountReturnStateError != null) {
      calculationFailure = accountReturnStateError;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, rothContributionBasis: {} };
      return calculationErrorYear(input, periodStart, calculationFailure);
    }
    const finalPlanMonth = periodMonths.at(-1);
    if (finalPlanMonth?.balances) {
      state.assets = {
        ...finalPlanMonth.balances.assets,
        ...Object.fromEntries(Object.entries(finalPlanMonth.balances.privateStock)
          .map(([assetId, value]) => [assetId, value.vestedCents])),
      };
      state.liabilities = { ...finalPlanMonth.balances.liabilities };
      if (homeSale != null) {
        for (const assetId of homeSale.assetIds) delete state.assets[assetId];
        for (const liabilityId of homeSale.liabilityIds) delete state.liabilities[liabilityId];
      }
    }
    const endingPlanStateError = invalidStateMessage(state);
    if (endingPlanStateError != null) {
      calculationFailure = endingPlanStateError;
      state = { accounts: {}, assets: {}, liabilities: {}, taxableBasis: {}, rothContributionBasis: {} };
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
    const housing = homeSale == null ? planHousing : {
      principalCents: 0,
      interestCents: 0,
      propertyTaxCents: 0,
      insuranceCents: 0,
      hoaCents: 0,
      maintenanceCents: 0,
    };
    const housingExpenseCents = Object.values(housing).reduce((sum, value) => sum + value, 0);
    const planRentalIncomeCents = periodMonths.reduce((sum, month) =>
      sum + month.properties.reduce((propertySum, property) =>
        propertySum + property.rentCents + property.aduIncomeCents, 0), 0);
    const rentalIncomeCents = homeSale == null ? planRentalIncomeCents : 0;
    const otherPreTaxIncomeCents = periodMonths.reduce(
      (sum, month) => sum + month.incomeCents,
      0,
    ) - planRentalIncomeCents;
    const taxableOutsideIncomeCents = periodMonths.reduce(
      (sum, month) => sum + month.taxableNonWageIncomeCents,
      0,
    ) + (homeSale == null ? Math.max(0, periodMonths.reduce((sum, month) =>
      sum + month.properties.reduce((propertySum, property) =>
        propertySum + property.taxableRentalCents, 0), 0)) : 0);
    const planHousingExpenseCents = Object.values(planHousing)
      .reduce((sum, value) => sum + value, 0);
    const planExpenseCents = Math.max(
      0,
      periodMonths.reduce((sum, month) => sum + month.expenseCents, 0) -
        planHousingExpenseCents,
    );

    const effectiveOrder = index === 0
      ? initialOrder
      : resolveRetirementAccountOrder(
        input.snapshot,
        `${periodStart}-01`,
        input.settings.withdrawalAccountOrder,
      );
    const targetDraw = drawRetirementFunds({
      amountCents: withdrawalTargetCents,
      date: `${periodStart}-01`,
      order: effectiveOrder,
      accounts: input.snapshot.accounts,
      balances: state.accounts,
      people: input.snapshot.household.people,
      taxableBasis: state.taxableBasis,
      rothContributionBasis: state.rothContributionBasis,
    });
    state = {
      ...state,
      accounts: { ...targetDraw.balances },
      taxableBasis: { ...targetDraw.taxableBasis },
      rothContributionBasis: { ...targetDraw.rothContributionBasis },
    };
    let withdrawalSources = [...targetDraw.sources];
    let estimatedTaxCents = calculateIncomeTax(
      input,
      year,
      taxableOutsideIncomeCents + targetDraw.ordinaryIncomeCents + targetDraw.rothTaxableCents,
      targetDraw.taxableGainCents,
      housing,
    );
    let earlyPenaltyCents = targetDraw.earlyPenaltyCents;
    let afterTaxIncomeCents = targetDraw.fundedCents + otherPreTaxIncomeCents +
      rentalIncomeCents - estimatedTaxCents - earlyPenaltyCents;
    const expenses = planExpenseCents + housingExpenseCents;
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
    const periodEnd = addMonths(periodStart, 11);
    for (const entry of input.snapshot.recurring) {
      const endMonth = entry.endDate?.slice(0, 7);
      if (endMonth != null && endMonth >= periodStart && endMonth <= periodEnd) warnings.push({
        code: "activity-ended",
        year,
        entityId: entry.id,
        message: `${entry.name} ends on ${entry.endDate}.`,
      });
    }

    if (surplusCents > 0 && destinationId != null && state.accounts[destinationId] != null) {
      state.accounts[destinationId] += surplusCents;
      state.taxableBasis[destinationId] = (state.taxableBasis[destinationId] ?? 0) + surplusCents;
    } else if (shortfallCents > 0) {
      const shortfallOrder = destinationId == null
        ? effectiveOrder
        : [destinationId, ...effectiveOrder.filter((accountId) => accountId !== destinationId)];
      let amountToDraw = shortfallCents;
      for (let pass = 0; pass < 8 && amountToDraw > 0; pass++) {
        const shortfallDraw = drawRetirementFunds({
          amountCents: amountToDraw,
          date: `${periodStart}-01`,
          order: shortfallOrder,
          accounts: input.snapshot.accounts,
          balances: state.accounts,
          people: input.snapshot.household.people,
          taxableBasis: state.taxableBasis,
          rothContributionBasis: state.rothContributionBasis,
        });
        state = {
          ...state,
          accounts: { ...shortfallDraw.balances },
          taxableBasis: { ...shortfallDraw.taxableBasis },
          rothContributionBasis: { ...shortfallDraw.rothContributionBasis },
        };
        withdrawalSources = combineSources(withdrawalSources, shortfallDraw.sources);
        const updatedTaxCents = calculateIncomeTax(
          input,
          year,
          taxableOutsideIncomeCents + sumSources(withdrawalSources, "ordinaryIncomeCents") +
            sumSources(withdrawalSources, "rothTaxableCents"),
          sumSources(withdrawalSources, "taxableGainCents"),
          housing,
        );
        const updatedPenaltyCents = sumSources(withdrawalSources, "earlyPenaltyCents");
        const addedTaxAndPenalty = Math.max(
          0,
          updatedTaxCents + updatedPenaltyCents - estimatedTaxCents - earlyPenaltyCents,
        );
        estimatedTaxCents = updatedTaxCents;
        earlyPenaltyCents = updatedPenaltyCents;
        shortfallCents += addedTaxAndPenalty;
        amountToDraw = shortfallDraw.unfundedCents + addedTaxAndPenalty;
        if (shortfallDraw.fundedCents === 0) break;
      }
      unfundedSpendingCents = amountToDraw;
      afterTaxIncomeCents = targetDraw.fundedCents + otherPreTaxIncomeCents +
        rentalIncomeCents - estimatedTaxCents - earlyPenaltyCents;
    }

    if (earlyPenaltyCents > 0) warnings.push({
      code: "early-withdrawal",
      year,
      message: `${earlyPenaltyCents} cents of early-distribution penalties were estimated.`,
    });
    for (const accountId of new Set(withdrawalSources
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
    const endingNetWorthCents = sumRecord(state.accounts) + sumRecord(state.assets) -
      sumRecord(state.liabilities);
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
      earlyPenaltyCents,
      afterTaxIncomeCents,
      planExpenseCents,
      housingExpenseCents,
      surplusCents,
      shortfallCents,
      destinationBalanceCents: destinationId == null ? 0 : state.accounts[destinationId] ?? 0,
      endingNetWorthCents,
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
        incrementalSaleTaxCents: homeSale.incrementalSaleTaxCents,
        netProceedsCents: homeSale.netProceedsCents,
      } } : {}),
      withdrawalSources,
      warnings,
    };
  });
};

export function calculateRetirementProjection(
  input: RetirementProjectionInput,
): RetirementProjectionResult {
  const scenario = extendScenarioHorizon(
    input.scenario,
    input.settings.retirementMonth,
    input.settings.horizonYears,
  );
  const cutoff = buildRetirementCutoff({
    snapshot: input.snapshot,
    scenario: input.scenario,
    retirementMonth: input.settings.retirementMonth,
    asOfDate: input.asOfDate,
  });
  const retirementSnapshot = calculateRetirementSnapshot({
    cutoff,
    snapshot: input.snapshot,
    scenario: input.scenario,
    withdrawalRateBps: input.settings.withdrawalRateBps,
  });
  const resolvedHomeSales = resolveRetirementHomeSales({
    cutoff,
    snapshot: input.snapshot,
    scenario: input.scenario,
    withdrawalRateBps: input.settings.withdrawalRateBps,
  });
  const projections = ProjectionEngine.calculate(
    input.snapshot,
    scenario,
    input.asOfDate,
    { stopEmploymentMonth: input.settings.retirementMonth },
  );
  const effectiveWithdrawalOrder = resolveRetirementAccountOrder(
    input.snapshot,
    `${input.settings.retirementMonth}-01`,
    input.settings.withdrawalAccountOrder,
  );
  const planMonths = projections.flatMap((projection) => projection.months);
  const keepYears = runRetirementScenario(
    input,
    cutoff,
    planMonths,
    effectiveWithdrawalOrder,
  );
  const sellYears = retirementSnapshot.sellHomes.available
    ? runRetirementScenario(
      input,
      cutoff,
      planMonths,
      effectiveWithdrawalOrder,
      {
        assetIds: resolvedHomeSales.homes.map((home) => home.property.assetId),
        liabilityIds: resolvedHomeSales.homes.flatMap((home) =>
          home.liabilityId == null ? [] : [home.liabilityId]),
        grossSaleValueCents: resolvedHomeSales.sales.reduce(
          (sum, sale) => sum + sale.salePriceCents,
          0,
        ),
        sellingCostsCents: retirementSnapshot.sellHomes.sellingCostsCents,
        mortgagePayoffCents: resolvedHomeSales.homes.reduce(
          (sum, home) => sum + home.mortgageCents,
          0,
        ),
        incrementalSaleTaxCents: retirementSnapshot.sellHomes.incrementalSaleTaxCents,
        netProceedsCents: retirementSnapshot.sellHomes.netHomeProceedsCents,
      },
    )
    : undefined;
  const unavailableSellWarnings = retirementSnapshot.sellHomes.available
    ? []
    : retirementSnapshot.sellHomes.issues.map((issue): RetirementProjectionWarning => ({
      code: "missing-home-data",
      entityId: issue.assetId,
      message: issue.message,
    }));
  const resultWarnings = uniqueWarnings([
    ...keepYears.flatMap((year) => year.warnings),
    ...(sellYears?.flatMap((year) => year.warnings) ?? unavailableSellWarnings),
  ]);

  return {
    retirementMonth: retirementSnapshot.retirementMonth,
    withdrawalRateBps: retirementSnapshot.withdrawalRateBps,
    netWorthCents: retirementSnapshot.netWorthCents,
    keepHomes: { available: true, summary: retirementSnapshot.keepHomes, years: keepYears },
    sellHomes: retirementSnapshot.sellHomes.available
      ? { available: true, summary: retirementSnapshot.sellHomes, years: sellYears! }
      : {
        available: false,
        issues: retirementSnapshot.sellHomes.issues,
        warnings: unavailableSellWarnings,
      },
    effectiveWithdrawalOrder,
    warnings: resultWarnings,
  };
}
