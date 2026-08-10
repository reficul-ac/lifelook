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
export interface RecurringEntry { id: string; name: string; amountCents: Cents; kind: "income" | "expense"; startDate: string; endDate?: string; annualGrowthBps?: BasisPoints }
export interface ImportProfile { id: string; name: string; columns: Readonly<Record<string, string>> }
export interface ImportBatch { id: string; importedAt: string; profileId?: string; rowCount: number }
export interface Asset { id: string; name: string; valueCents: Cents; annualGrowthBps: BasisPoints }
export interface MortgageTerms { originalPrincipalCents: Cents; termMonths: number; startDate: string; paymentOverrideCents?: Cents }
export interface Liability { id: string; name: string; balanceCents: Cents; annualRateBps: BasisPoints; minimumPaymentCents: Cents; mortgage?: MortgageTerms }
export interface GrowthAssumption { inflationBps: BasisPoints; thresholdInflationBps: BasisPoints }
export interface AllocationRule { accountId: string; percentBps: BasisPoints; priority: number }
export interface ProjectionHorizon { start: string; months: number }
export type ScenarioEvent =
  | { id: string; date: string; type: "income-change"; entryId: string; amountCents: Cents }
  | { id: string; date: string; type: "one-time-income" | "one-time-expense"; amountCents: Cents }
  | { id: string; date: string; type: "account-contribution"; accountId: string; amountCents: Cents };
export interface Scenario { id: string; name: string; assumptions: GrowthAssumption; events: readonly ScenarioEvent[]; allocations: readonly AllocationRule[]; horizon: ProjectionHorizon }
export interface FinancialSnapshot { household: Household; taxProfile: TaxProfile; accounts: readonly Account[]; recurring: readonly RecurringEntry[]; assets: readonly Asset[]; liabilities: readonly Liability[] }
export interface MonthlyProjection { month: string; incomeCents: Cents; expenseCents: Cents; taxCents: Cents; surplusCents: Cents; liquidWorthCents: Cents; netWorthCents: Cents; debtCents: Cents }
export interface AnnualProjection { year: number; incomeCents: Cents; expenseCents: Cents; taxCents: Cents; surplusCents: Cents; endingNetWorthCents: Cents; months: readonly MonthlyProjection[] }
export interface TaxBracket { upToCents: Cents | null; rateBps: BasisPoints }
export interface TaxRulePack { year: 2025 | 2026; federal: Record<FilingStatus, { standardDeductionCents: Cents; brackets: readonly TaxBracket[] }>; california: Record<FilingStatus, { standardDeductionCents: Cents; brackets: readonly TaxBracket[] }>; socialSecurityWageBaseCents: Cents; additionalMedicareThresholdCents: Record<FilingStatus, Cents> }
export interface TaxEstimate { federalCents: Cents; californiaCents: Cents; socialSecurityCents: Cents; medicareCents: Cents; totalCents: Cents; effectiveRateBps: BasisPoints; sourceYear: number; projected: boolean }
