export type Cents = number;
export type BasisPoints = number;

export interface Person { id: string; name: string; birthDate?: string }
export interface Household { id: string; name: string; people: readonly Person[]; state: string }
export type FilingStatus = "single" | "married-joint" | "married-separate" | "head-of-household";
export interface TaxProfile { filingStatus: FilingStatus; state: "CA"; taxYear: 2025 | 2026; thresholdInflationBps: BasisPoints }
export interface AppSettings { theme: "system" | "light" | "dark"; currency: "USD"; reducedMotion: boolean }
export type AccountKind = "checking" | "savings" | "investment" | "retirement" | "credit";
export interface Account { id: string; name: string; kind: AccountKind; balanceCents: Cents; annualReturnBps: BasisPoints; liquid: boolean }
export interface Category { id: string; name: string; kind: "income" | "expense" | "transfer" }
export interface Transaction { id: string; date: string; amountCents: Cents; accountId: string; categoryId: string; transferAccountId?: string; note?: string }
export type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
export interface RecurringEntry { id: string; name: string; amountCents: Cents; kind: "income" | "expense"; categoryId?: string; accountId?: string; frequency?: RecurringFrequency; startDate: string; endDate?: string; annualGrowthBps?: BasisPoints }
export interface ImportProfile { id: string; name: string; columns: Readonly<Record<string, string>> }
export interface ImportBatch { id: string; importedAt: string; profileId?: string; rowCount: number }
export interface Asset { id: string; name: string; valueCents: Cents; annualGrowthBps: BasisPoints }
export interface MortgageTerms { originalPrincipalCents: Cents; termMonths: number; startDate: string; paymentOverrideCents?: Cents }
export interface Liability { id: string; name: string; balanceCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents; mortgage?: MortgageTerms }
export interface GrowthAssumption { inflationBps: BasisPoints; thresholdInflationBps: BasisPoints }
export interface AllocationRule { id?: string; accountId: string; percentBps: BasisPoints; priority: number; targetBalanceCents?: Cents }
export interface ProjectionHorizon { start: string; months: number }
export type ScenarioEvent =
  | { id: string; date: string; type: "recurring-change" | "income-change"; entryId: string; amountCents: Cents }
  | { id: string; date: string; type: "one-time-income" | "one-time-expense"; amountCents: Cents }
  | { id: string; date: string; type: "account-transfer"; fromAccountId: string; toAccountId: string; amountCents: Cents }
  | { id: string; date: string; type: "account-contribution"; accountId: string; amountCents: Cents }
  | { id: string; date: string; type: "asset-purchase"; assetId: string; name: string; valueCents: Cents; annualGrowthBps: BasisPoints; fundingAccountId: string; downPaymentCents: Cents; costsCents: Cents; financing?: { liabilityId: string; name: string; principalCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents } }
  | { id: string; date: string; type: "asset-sale"; assetId: string; proceedsCents: Cents; costsCents: Cents; destinationAccountId: string; payoff?: { liabilityId: string; mode: "none" | "partial" | "full"; amountCents?: Cents } }
  | { id: string; date: string; type: "debt-origination"; liabilityId: string; name: string; principalCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents; accountId: string }
  | { id: string; date: string; type: "debt-payoff"; liabilityId: string; accountId: string; amountCents?: Cents };
export interface Scenario { id: string; name: string; assumptions: GrowthAssumption; events: readonly ScenarioEvent[]; allocations: readonly AllocationRule[]; horizon: ProjectionHorizon }
export interface FinancialSnapshot { household: Household; taxProfile: TaxProfile; accounts: readonly Account[]; recurring: readonly RecurringEntry[]; assets: readonly Asset[]; liabilities: readonly Liability[] }
export interface MonthlyProjection { month: string; incomeCents: Cents; expenseCents: Cents; taxCents: Cents; surplusCents: Cents; liquidWorthCents: Cents; netWorthCents: Cents; debtCents: Cents; unfundedDeficitCents: Cents; warnings: readonly string[] }
export interface AnnualProjection { year: number; incomeCents: Cents; expenseCents: Cents; taxCents: Cents; surplusCents: Cents; liquidWorthCents: Cents; endingNetWorthCents: Cents; debtCents: Cents; unfundedDeficitCents: Cents; warnings: readonly string[]; months: readonly MonthlyProjection[] }
export interface TaxBracket { upToCents: Cents | null; rateBps: BasisPoints }
export interface TaxRulePack { year: 2025 | 2026; federal: Record<FilingStatus, { standardDeductionCents: Cents; brackets: readonly TaxBracket[] }>; california: Record<FilingStatus, { standardDeductionCents: Cents; brackets: readonly TaxBracket[] }>; socialSecurityWageBaseCents: Cents; additionalMedicareThresholdCents: Record<FilingStatus, Cents> }
export interface TaxEstimate { federalCents: Cents; californiaCents: Cents; socialSecurityCents: Cents; medicareCents: Cents; totalCents: Cents; effectiveRateBps: BasisPoints; sourceYear: number; projected: boolean }
