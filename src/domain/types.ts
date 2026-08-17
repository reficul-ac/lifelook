export type Cents = number;
export type BasisPoints = number;

export interface Person { id: string; name: string; birthDate?: string }
export interface Household { id: string; name: string; people: readonly Person[]; state: string }
export type FilingStatus = "single" | "married-joint" | "married-separate" | "head-of-household";
export interface TaxUnit { id:string; filingStatus:FilingStatus; memberPersonIds:readonly string[] }
export interface TaxProfile { filingStatus: FilingStatus; state: "CA"; taxYear: 2025 | 2026; thresholdInflationBps: BasisPoints; taxUnit?:TaxUnit }
export interface AppSettings { theme: "system" | "light" | "dark"; currency: "USD"; reducedMotion: boolean }
export type AccountKind = "checking" | "savings" | "investment" | "retirement" | "credit";
export interface Account { id: string; name: string; kind: AccountKind; balanceCents: Cents; annualReturnBps: BasisPoints; liquid: boolean }
export interface Category { id: string; name: string; kind: "income" | "expense" | "transfer"; archived: boolean }
export interface Transaction { id: string; date: string; amountCents: Cents; accountId: string; categoryId: string; transferAccountId?: string; note?: string }
export type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
export type IncomeTaxCategory="wages"|"taxable-nonwage"|"nontaxable";
export interface RecurringEntry { id: string; name: string; amountCents: Cents; kind: "income" | "expense"; incomeType?:"ordinary"|"salary"; incomeTaxCategory?:IncomeTaxCategory; ownerPersonId?:string|null; categoryId?: string; accountId?: string; frequency?: RecurringFrequency; startDate: string; endDate?: string; annualGrowthBps?: BasisPoints; annualGrowthMonth?:number|null; annualGrowthCapCents?:Cents|null; taxTreatment: "none" | "pretax" }
export interface ImportProfile { id: string; name: string; columns: Readonly<Record<string, string>> }
export interface ImportBatch { id: string; importedAt: string; profileId?: string; rowCount: number }
export interface HousingCosts { propertyTaxRateBps: BasisPoints; insuranceMonthlyCents: Cents; insuranceAnnualGrowthBps: BasisPoints; hoaMonthlyCents: Cents; hoaAnnualGrowthBps: BasisPoints }
export interface AppreciationCurve { startYear:number; startRateBps:BasisPoints; endYear:number; endRateBps:BasisPoints }
export interface PrivateStockVesting { vestedBps:BasisPoints; vestingStartDate:string; remainingVestingQuarters:number; taxOnVest?:boolean }
export interface RsuVestEvent { id:string; date:string; unitsMicros:number; actualFmvCents?:Cents|null }
export interface RsuGrant { id:string; ownerPersonId:string; grantDate:string; grantPriceCents:Cents; unitsMicros:number; vestEvents:readonly RsuVestEvent[]; reviewRequired?:boolean }
export interface EquityHolding { priceCents:Cents; priceDate:string; appreciationCurve?:AppreciationCurve|null; sellToCover:boolean; grants:readonly RsuGrant[] }
export interface Asset { id: string; name: string; valueCents: Cents; annualGrowthBps: BasisPoints; appreciationCurve?:AppreciationCurve|null; privateStock?:PrivateStockVesting|null; equityHolding?:EquityHolding|null; housingCosts?: HousingCosts; housingStartDate?: string; purchasePriceCents?: Cents | null; purchaseDate?: string | null }
export interface MortgageTerms { originalPrincipalCents: Cents; termMonths: number; startDate: string; paymentOverrideCents?: Cents; assetId?: string | null }
export interface Liability { id: string; name: string; balanceCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents; mortgage?: MortgageTerms }
export interface GrowthAssumption { inflationBps: BasisPoints; thresholdInflationBps: BasisPoints }
export type ContributionDestinationType = "account" | "asset" | "mortgage";
export type ContributionOverflowType = "account" | "asset";
export interface ContributionRule { id: string; destinationType: ContributionDestinationType; destinationId: string; percentBps?: BasisPoints; monthlyAmountCents?: Cents; frequency: RecurringFrequency; targetBalanceCents?: Cents; overflowDestinationType?: ContributionOverflowType; overflowDestinationId?: string }
export interface WithdrawalRule { id?: string; accountId: string; priority: number }
export interface ProjectionHorizon { start: string; months: number }
export type ScenarioEvent =
  | { id: string; date: string; type: "recurring-change" | "income-change"; entryId: string; amountCents: Cents }
  | { id: string; date: string; type: "one-time-income"; amountCents: Cents; incomeTaxCategory?:IncomeTaxCategory; ownerPersonId?:string }
  | { id: string; date: string; type: "one-time-expense"; amountCents: Cents }
  | { id: string; date: string; type: "account-transfer"; fromAccountId: string; toAccountId: string; amountCents: Cents }
  | { id: string; date: string; type: "account-contribution"; accountId: string; amountCents: Cents }
  | { id: string; date: string; type: "asset-purchase"; assetId: string; name: string; valueCents: Cents; annualGrowthBps: BasisPoints; housingCosts?: HousingCosts; fundingAccountId: string; downPaymentCents: Cents; costsCents: Cents; financing?: { liabilityId: string; name: string; principalCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents } }
  | { id: string; date: string; type: "asset-sale"; assetId: string; proceedsCents: Cents; costsCents: Cents; destinationAccountId: string; payoff?: { liabilityId: string; mode: "none" | "partial" | "full"; amountCents?: Cents } }
  | { id: string; date: string; type: "debt-origination"; liabilityId: string; name: string; principalCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents; accountId: string }
  | { id: string; date: string; type: "debt-payoff"; liabilityId: string; accountId: string; amountCents?: Cents };
export interface Scenario { id: string; name: string; assumptions: GrowthAssumption; assumptionsInherited: boolean; events: readonly ScenarioEvent[]; defaultContributionAccountId?: string; contributions: readonly ContributionRule[]; withdrawals: readonly WithdrawalRule[]; horizon: ProjectionHorizon }
export interface LedgerActual { date: string; kind: "income" | "expense" | "transfer" | "adjustment"; amountCents: Cents }
export interface FinancialSnapshot { household: Household; taxProfile: TaxProfile; accounts: readonly Account[]; recurring: readonly RecurringEntry[]; assets: readonly Asset[]; liabilities: readonly Liability[]; actuals?: readonly LedgerActual[] }
export type ProjectionStatus = "actual" | "blended" | "projected";
export interface ProjectionWarning { code: "account-depleted" | "unfunded-deficit" | "invalid-contribution" | "aggressive-assumption" | "negative-balance" | "payment-below-interest"; message: string; month: string; entityId?: string; inputField?: string }
export interface ProjectionBalances {
  accounts: Readonly<Record<string, Cents>>;
  assets: Readonly<Record<string, Cents>>;
  privateStock: Readonly<Record<string, { vestedCents: Cents; unvestedCents: Cents }>>;
  liabilities: Readonly<Record<string, Cents>>;
}
export interface ContributionResult { ruleId: string; destinationType: ContributionDestinationType; destinationId: string; amountCents: Cents }
export interface MonthlyProjection { month: string; status: ProjectionStatus; incomeCents: Cents; expenseCents: Cents; actualIncomeCents: Cents; actualExpenseCents: Cents; incomeVarianceCents: Cents; expenseVarianceCents: Cents; taxCents: Cents; cashTaxCents:Cents; rsuSellToCoverTaxCents:Cents; surplusCents: Cents; liquidWorthCents: Cents | null; netWorthCents: Cents | null; debtCents: Cents | null; balances: ProjectionBalances | null; unfundedDeficitCents: Cents; contributionCents: Cents; contributionResults:readonly ContributionResult[]; principalAndInterestCents: Cents; housingCostCents: Cents; warnings: readonly ProjectionWarning[] }
export interface AnnualProjection { year: number; incomeCents: Cents; expenseCents: Cents; actualIncomeCents: Cents; actualExpenseCents: Cents; taxCents: Cents; cashTaxCents:Cents; rsuSellToCoverTaxCents:Cents; taxLedger?:TaxLedger; savingsRateBps: BasisPoints; surplusCents: Cents; contributionCents: Cents; contributionResults:readonly ContributionResult[]; liquidWorthCents: Cents | null; endingNetWorthCents: Cents | null; debtCents: Cents | null; debtPayoffMonth?: string; unfundedDeficitCents: Cents; warnings: readonly ProjectionWarning[]; months: readonly MonthlyProjection[] }
export interface TaxBracket { upToCents: Cents | null; rateBps: BasisPoints }
export interface TaxSource { jurisdiction: "federal" | "california" | "payroll"; sourceYear: number; status: "official" | "projected"; url: string }
export interface TaxRulePack { year: 2025 | 2026; federal: Record<FilingStatus, { standardDeductionCents: Cents; brackets: readonly TaxBracket[] }>; california: Record<FilingStatus, { standardDeductionCents: Cents; brackets: readonly TaxBracket[] }>; federalLongTermCapitalGains:Record<FilingStatus,readonly TaxBracket[]>; unrecapturedSection1250MaxRateBps:BasisPoints; netInvestmentIncomeThresholdCents:Record<FilingStatus,Cents>; socialSecurityWageBaseCents: Cents; additionalMedicareThresholdCents: Record<FilingStatus, Cents>; sources: readonly TaxSource[] }
export interface TaxabilityBreakdown { grossWageIncomeCents: Cents; federalDeductionCents: Cents; californiaDeductionCents: Cents; ficaExemptWagesCents: Cents }
export interface EmployeeWages { personId:string; salaryCents:Cents; rsuCents:Cents }
export interface HouseholdDeductions { traditionalRetirementCents:Cents; mortgageInterestCents:Cents; mortgageDebtCents?:Cents; propertyTaxCents:Cents; stateIncomeTaxCents?:Cents }
export interface TaxLedger { year:number; employees:readonly (EmployeeWages&{socialSecurityCents:Cents;medicareCents:Cents;sdiCents:Cents})[]; grossIncomeCents:Cents; federalStandardCents:Cents; federalItemizedCents:Cents; federalDeductionCents:Cents; federalTaxableCents:Cents; californiaStandardCents:Cents; californiaItemizedCents:Cents; californiaDeductionCents:Cents; californiaTaxableCents:Cents; federalCents:Cents; californiaCents:Cents; socialSecurityCents:Cents; medicareCents:Cents; additionalMedicareCents:Cents; sdiCents:Cents; fullYearLiabilityCents:Cents; futureCashFlowCents:Cents; refundOrBalanceDue:"unknown"; sources:readonly TaxSource[]; projected:boolean }
export interface TaxEstimate { federalCents: Cents; californiaCents: Cents; socialSecurityCents: Cents; medicareCents: Cents; additionalMedicareCents?:Cents; sdiCents?:Cents; totalCents: Cents; effectiveRateBps: BasisPoints; marginalRateBps: BasisPoints; sourceYear: number; projected: boolean; sources: readonly TaxSource[] }
