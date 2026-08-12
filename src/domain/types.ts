export type Cents = number;
export type BasisPoints = number;

export interface Person { id: string; name: string; birthDate?: string }
export interface Household { id: string; name: string; people: readonly Person[]; state: string }
export type FilingStatus = "single" | "married-joint" | "married-separate" | "head-of-household";
export interface TaxProfile { filingStatus: FilingStatus; state: "CA"; taxYear: 2025 | 2026; thresholdInflationBps: BasisPoints }
export interface AppSettings { theme: "system" | "light" | "dark"; currency: "USD"; reducedMotion: boolean }
export type AccountKind = "checking" | "savings" | "investment" | "retirement" | "credit";
export interface Account { id: string; name: string; kind: AccountKind; balanceCents: Cents; annualReturnBps: BasisPoints; liquid: boolean }
export interface Category { id: string; name: string; kind: "income" | "expense" | "transfer"; archived: boolean }
export interface Transaction { id: string; date: string; amountCents: Cents; accountId: string; categoryId: string; transferAccountId?: string; note?: string }
export type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
export interface RecurringEntry { id: string; name: string; amountCents: Cents; kind: "income" | "expense"; incomeType?:"ordinary"|"salary"; categoryId?: string; accountId?: string; frequency?: RecurringFrequency; startDate: string; endDate?: string; annualGrowthBps?: BasisPoints; taxTreatment: "none" | "pretax" }
export interface ImportProfile { id: string; name: string; columns: Readonly<Record<string, string>> }
export interface ImportBatch { id: string; importedAt: string; profileId?: string; rowCount: number }
export interface HousingCosts { propertyTaxRateBps: BasisPoints; insuranceMonthlyCents: Cents; insuranceAnnualGrowthBps: BasisPoints; hoaMonthlyCents: Cents; hoaAnnualGrowthBps: BasisPoints }
export interface AppreciationCurve { startYear:number; startRateBps:BasisPoints; endYear:number; endRateBps:BasisPoints }
export interface PrivateStockVesting { vestedBps:BasisPoints; vestingStartDate:string; remainingVestingQuarters:number; taxOnVest?:boolean }
export interface Asset { id: string; name: string; valueCents: Cents; annualGrowthBps: BasisPoints; appreciationCurve?:AppreciationCurve|null; privateStock?:PrivateStockVesting|null; housingCosts?: HousingCosts; housingStartDate?: string; purchasePriceCents?: Cents | null; purchaseDate?: string | null }
export interface MortgageTerms { originalPrincipalCents: Cents; termMonths: number; startDate: string; paymentOverrideCents?: Cents; assetId?: string | null }
export interface Liability { id: string; name: string; balanceCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents; mortgage?: MortgageTerms }
export interface GrowthAssumption { inflationBps: BasisPoints; thresholdInflationBps: BasisPoints }
export interface AllocationRule { id?: string; accountId: string; percentBps: BasisPoints; priority: number; targetBalanceCents?: Cents }
export interface WithdrawalRule { id?: string; accountId: string; priority: number }
export interface ProjectionHorizon { start: string; months: number }
export type GoalType = "retirement" | "emergency-fund" | "debt-payoff" | "education" | "major-purchase";
export interface GoalCommon { id:string; scenarioId:string; type:GoalType; name:string; priority:number; enabled:boolean; targetDate:string; todayDollarBasis:boolean; startingEarmarkedCents:Cents; allowCashShortfall:boolean; revision:number }
export interface EmergencyFundGoal extends GoalCommon { type:"emergency-fund"; destinationAccountId:string; expenseEntryIds:readonly string[]; coverageMonths:number; minimumTargetCents?:Cents }
export interface DebtPayoffGoal extends GoalCommon { type:"debt-payoff"; liabilityId:string; destinationAccountId:string }
export interface EducationGoal extends GoalCommon { type:"education"; beneficiary:string; attendanceStartDate:string; attendanceEndDate:string; annualCostCents:Cents; educationInflationBps:BasisPoints; destinationAccountId:string }
export interface MajorPurchaseGoal extends GoalCommon { type:"major-purchase"; purchaseDate:string; costCents:Cents; destinationAccountId:string }
export interface RetirementGoal extends GoalCommon { type:"retirement"; participantIds:readonly string[]; retirementDates:Readonly<Record<string,string>>; planningThroughAges:Readonly<Record<string,number>>; desiredSpendingCents:Cents; healthcareCents:Cents; healthcareGrowthBps:BasisPoints; destinationAccountId:string; pensions:readonly {id:string;name:string;monthlyCents:Cents;startDate:string}[] }
export type ScenarioGoal = EmergencyFundGoal | DebtPayoffGoal | EducationGoal | MajorPurchaseGoal | RetirementGoal;
export interface GoalFundingResult { goalId:string; requiredCents:Cents; fundedCents:Cents; shortfallCents:Cents; earmarkedCents:Cents; targetCents:Cents; completionBps:BasisPoints; projectedCompletionDate?:string; targetResult:"on-track"|"completed"|"missed"|"infeasible"|"outside-horizon" }
export type ScenarioEvent =
  | { id: string; date: string; type: "recurring-change" | "income-change"; entryId: string; amountCents: Cents }
  | { id: string; date: string; type: "one-time-income" | "one-time-expense"; amountCents: Cents }
  | { id: string; date: string; type: "account-transfer"; fromAccountId: string; toAccountId: string; amountCents: Cents }
  | { id: string; date: string; type: "account-contribution"; accountId: string; amountCents: Cents }
  | { id: string; date: string; type: "asset-purchase"; assetId: string; name: string; valueCents: Cents; annualGrowthBps: BasisPoints; housingCosts?: HousingCosts; fundingAccountId: string; downPaymentCents: Cents; costsCents: Cents; financing?: { liabilityId: string; name: string; principalCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents } }
  | { id: string; date: string; type: "asset-sale"; assetId: string; proceedsCents: Cents; costsCents: Cents; destinationAccountId: string; payoff?: { liabilityId: string; mode: "none" | "partial" | "full"; amountCents?: Cents } }
  | { id: string; date: string; type: "debt-origination"; liabilityId: string; name: string; principalCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents; accountId: string }
  | { id: string; date: string; type: "debt-payoff"; liabilityId: string; accountId: string; amountCents?: Cents };
export interface Scenario { id: string; name: string; assumptions: GrowthAssumption; assumptionsInherited: boolean; events: readonly ScenarioEvent[]; allocations: readonly AllocationRule[]; withdrawals: readonly WithdrawalRule[]; horizon: ProjectionHorizon; goals:readonly ScenarioGoal[] }
export interface LedgerActual { date: string; kind: "income" | "expense" | "transfer" | "adjustment"; amountCents: Cents }
export interface FinancialSnapshot { household: Household; taxProfile: TaxProfile; accounts: readonly Account[]; recurring: readonly RecurringEntry[]; assets: readonly Asset[]; liabilities: readonly Liability[]; actuals?: readonly LedgerActual[] }
export type ProjectionStatus = "actual" | "blended" | "projected";
export interface ProjectionWarning { code: "account-depleted" | "unfunded-deficit" | "invalid-allocation" | "aggressive-assumption" | "negative-balance" | "payment-below-interest" | "goal-shortfall" | "goal-missed" | "goal-outside-horizon" | "goal-validation" | "goal-conflict" | "insufficient-earmark" | "retirement-depletion"; message: string; month: string; entityId?: string; inputField?: string }
export interface ProjectionBalances {
  accounts: Readonly<Record<string, Cents>>;
  assets: Readonly<Record<string, Cents>>;
  privateStock: Readonly<Record<string, { vestedCents: Cents; unvestedCents: Cents }>>;
  liabilities: Readonly<Record<string, Cents>>;
}
export interface MonthlyProjection { month: string; status: ProjectionStatus; incomeCents: Cents; expenseCents: Cents; actualIncomeCents: Cents; actualExpenseCents: Cents; incomeVarianceCents: Cents; expenseVarianceCents: Cents; taxCents: Cents; surplusCents: Cents; liquidWorthCents: Cents | null; netWorthCents: Cents | null; debtCents: Cents | null; balances: ProjectionBalances | null; unfundedDeficitCents: Cents; allocationCents: Cents; goalFundingCents:Cents; goalResults:readonly GoalFundingResult[]; principalAndInterestCents: Cents; housingCostCents: Cents; warnings: readonly ProjectionWarning[] }
export interface AnnualProjection { year: number; incomeCents: Cents; expenseCents: Cents; actualIncomeCents: Cents; actualExpenseCents: Cents; taxCents: Cents; savingsRateBps: BasisPoints; surplusCents: Cents; allocationCents: Cents; goalFundingCents:Cents; goalResults:readonly GoalFundingResult[]; liquidWorthCents: Cents | null; endingNetWorthCents: Cents | null; debtCents: Cents | null; debtPayoffMonth?: string; unfundedDeficitCents: Cents; warnings: readonly ProjectionWarning[]; months: readonly MonthlyProjection[] }
export interface TaxBracket { upToCents: Cents | null; rateBps: BasisPoints }
export interface TaxSource { jurisdiction: "federal" | "california" | "payroll"; sourceYear: number; status: "official" | "projected"; url: string }
export interface TaxRulePack { year: 2025 | 2026; federal: Record<FilingStatus, { standardDeductionCents: Cents; brackets: readonly TaxBracket[] }>; california: Record<FilingStatus, { standardDeductionCents: Cents; brackets: readonly TaxBracket[] }>; socialSecurityWageBaseCents: Cents; additionalMedicareThresholdCents: Record<FilingStatus, Cents>; sources: readonly TaxSource[] }
export interface TaxabilityBreakdown { grossWageIncomeCents: Cents; federalDeductionCents: Cents; californiaDeductionCents: Cents; ficaExemptWagesCents: Cents }
export interface TaxEstimate { federalCents: Cents; californiaCents: Cents; socialSecurityCents: Cents; medicareCents: Cents; totalCents: Cents; effectiveRateBps: BasisPoints; marginalRateBps: BasisPoints; sourceYear: number; projected: boolean; sources: readonly TaxSource[] }
