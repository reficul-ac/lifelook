/** Stored values are plain JSON; all monetary amounts are validated integer USD cents. */
export type Cents = number;
export type BasisPoints = number;
export type ISODate = string;
export type YearMonth = string;
export type History<T> = Readonly<{ known: true; value: T }> | Readonly<{ known: false }>;
export type TaxBook = 'federal' | 'california' | 'federal-amt' | 'california-amt';

export interface CoverageAnswers {
  readonly additionalIncome: History<boolean>;
  readonly additionalCredits: History<boolean>;
  readonly qualifiedDividendsOrCapitalGains: History<boolean>;
  readonly retirementDistributions: History<boolean>;
  readonly priorFederalMinimumTaxCredits: History<boolean>;
  readonly priorCaliforniaMinimumTaxCredits: History<boolean>;
}
export interface AnnualWorkplaceCoverage {
  readonly year: number;
  readonly workplaceCoverage: History<boolean>;
}
export interface EmployerYearAssumptions {
  readonly year: number;
  readonly employerId: string;
  readonly priorYearWagesCents: History<Cents>;
  readonly planCatchUpAvailable: History<boolean>;
  readonly rothCatchUpAvailable: History<boolean>;
}
export interface Filer {
  readonly id: string;
  readonly name: string;
  readonly birthDate: History<ISODate>;
  readonly workplaceCoverage: History<boolean>;
  readonly coverageByYear: readonly AnnualWorkplaceCoverage[];
  readonly employerAssumptionsByYear: readonly EmployerYearAssumptions[];
}
export interface Household {
  readonly filers: readonly [Filer, Filer];
  readonly filingStatus: 'married-joint';
  readonly residence: 'CA-full-year';
  readonly currency: 'USD';
  readonly coverageAnswers: CoverageAnswers;
}
export interface StateTaxPaymentOverride {
  readonly year: number;
  readonly californiaIncomeTaxPaidCents: Cents;
  readonly sdiPaidCents: Cents;
}
export interface TaxPolicy {
  readonly baselineYear: 2026;
  readonly futureIndexGrowthBps: BasisPoints;
  readonly actualStateTaxPaidByYear: readonly StateTaxPaymentOverride[];
}
export type SalaryChange = Readonly<{ date: ISODate; kind: 'percent'; percentBps: BasisPoints }> | Readonly<{ date: ISODate; kind: 'amount'; annualGrossCents: Cents }>;
export interface Salary {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly employerId: string;
  readonly annualGrossCents: Cents;
  readonly startDate: ISODate;
  readonly endDate?: ISODate;
  readonly annualRaiseBps: BasisPoints;
  readonly raiseMonth: number;
  readonly raiseDay: number;
  readonly changes: readonly SalaryChange[];
}
export interface RecurringPayment {
  readonly id: string;
  readonly name: string;
  readonly amountCents: Cents;
  readonly frequency: 'monthly' | 'annual';
  readonly startDate: ISODate;
  readonly endDate?: ISODate;
  readonly annualGrowthBps: BasisPoints;
}
export type OtherIncome = RecurringPayment & (
  Readonly<{ classification: 'wage'; ownerId: string; employerId: string; niitTreatment?: never }> |
  Readonly<{ classification: 'ordinary-taxable'; niitTreatment: 'included' | 'excluded' | 'unknown'; ownerId?: string; employerId?: never }> |
  Readonly<{ classification: 'non-taxable'; ownerId?: string; employerId?: never; niitTreatment?: never }>
);
export interface AllocationShare { readonly numerator: number; readonly denominator: number }
export interface Expense extends RecurringPayment {
  readonly propertyId?: string;
  readonly rentalId?: string;
  readonly use: 'personal' | 'rental' | 'shared';
  readonly allocationOverride?: AllocationShare;
  readonly taxCategory: 'property-tax' | 'homeowners-insurance' | 'mortgage-insurance' | 'repair' | 'operating' | 'capital' | 'personal';
}
export type AccountType = 'taxable-brokerage' | 'traditional-401k' | 'roth-401k' | 'traditional-ira' | 'roth-ira';
export interface Account {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly type: AccountType;
  readonly openingBalanceCents: Cents;
  readonly annualGrowthBps: BasisPoints;
  readonly openingIraBasis: History<Cents>;
}
export type ContributionAmount = Readonly<{ kind: 'fixed'; monthlyCents: Cents }> | Readonly<{ kind: 'salary-percent'; salaryId: string; percentBps: BasisPoints }>;
export interface ContributionRule {
  readonly id: string;
  readonly accountId: string;
  readonly priority: number;
  readonly startDate: ISODate;
  readonly endDate?: ISODate;
  readonly amount: ContributionAmount;
  readonly sponsoringSalaryId?: string;
}
export interface Debt {
  readonly id: string;
  readonly name: string;
  readonly openingBalanceCents: Cents;
  readonly aprBps: BasisPoints;
  readonly monthlyPaymentCents: Cents;
  readonly firstPaymentMonth: YearMonth;
  readonly propertyId?: string;
}
export interface LoanProceedsQualification {
  readonly kind: 'acquisition' | 'refinance' | 'cash-out' | 'mixed' | 'grandfathered' | 'unknown';
  readonly qualifiedAcquisitionDebt: History<boolean>;
  readonly qualifiedPrincipalCents: History<Cents>;
  readonly historyComplete: History<boolean>;
}
export interface LoanProceedsAllocation {
  readonly propertyId: string;
  readonly rentalId?: string;
  readonly use: 'personal' | 'rental';
  readonly share: AllocationShare;
}
export interface PropertyLoan {
  readonly id: string;
  readonly name: string;
  readonly originalPrincipalCents: Cents;
  readonly aprBps: BasisPoints;
  readonly originationDate: ISODate;
  readonly acquisitionDate: ISODate;
  readonly termMonths: number;
  readonly firstPaymentDate: ISODate;
  readonly openingBalance: History<Cents>;
  readonly openingPayment: History<Cents>;
  readonly collateralPropertyId: string;
  readonly proceedsQualification: LoanProceedsQualification;
  readonly proceedsAllocations: readonly LoanProceedsAllocation[];
  readonly financingAtRiskQualification: History<boolean>;
}
export interface AppreciationOverride { readonly year: number; readonly rateBps: BasisPoints }
export interface Property {
  readonly id: string;
  readonly name: string;
  readonly role: 'primary' | 'rental' | 'primary-with-adu';
  readonly purchaseDate: ISODate;
  readonly purchasePriceCents: Cents;
  readonly downPaymentCents: Cents;
  readonly openingValueCents: Cents;
  readonly appreciationBps: BasisPoints;
  readonly appreciationOverrides: readonly AppreciationOverride[];
  readonly primaryArea?: number;
  readonly aduArea?: number;
  readonly loans: readonly PropertyLoan[];
}
export interface RentalLossVintage {
  readonly year: number;
  readonly source: 'at-risk' | 'passive';
  readonly amountCents: Cents;
}
export interface RentalBookState {
  readonly recoveryBasisCents: Cents;
  readonly adjustedBuildingBasisCents: Cents;
  readonly cumulativeDepreciationCents: Cents;
  readonly atRiskCents: Cents;
  readonly atRiskSuspendedCents: Cents;
  readonly passiveSuspendedCents: Cents;
  readonly lossVintages: readonly RentalLossVintage[];
}
export interface QbiLossVintage { readonly year: number; readonly amountCents: Cents }
export interface RentalQbi {
  readonly qualification: History<boolean>;
  readonly wagesCents: History<Cents>;
  readonly ubiaCents: History<Cents>;
  readonly openingLossVintages: History<readonly QbiLossVintage[]>;
}
export interface RentalQualifications {
  readonly longTermFairMarketLease: History<boolean>;
  readonly noPersonalUse: History<boolean>;
  readonly noSubstantialTenantServices: History<boolean>;
  readonly ordinaryResidential: History<boolean>;
  readonly advancedBasisAdjustments: History<boolean>;
}
export interface RentalLoanAllocation {
  readonly loanId: string;
  readonly share: AllocationShare;
  readonly qualification: History<boolean>;
}
export interface RentalUnit {
  readonly id: string;
  readonly propertyId: string;
  readonly monthlyRentCents: Cents;
  readonly rentGrowthBps: BasisPoints;
  readonly rentStartDate: ISODate;
  readonly rentEndDate?: ISODate;
  readonly availableDate: ISODate;
  readonly activeParticipation: History<boolean>;
  readonly sharedAllocation?: AllocationShare;
  readonly loanAllocations: readonly RentalLoanAllocation[];
  readonly qualifications: RentalQualifications;
  readonly convertedFromPersonalUse: boolean;
  readonly conversionBuildingFmv: History<Cents>;
  readonly taxHistory: Readonly<Record<TaxBook, History<RentalBookState>>>;
  readonly qbi: RentalQbi;
}
export interface PlanDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly startYear: number;
  readonly horizonYears: number;
  readonly openingCashCents: Cents;
  readonly household: Household;
  readonly taxPolicy: TaxPolicy;
  readonly salaries: readonly Salary[];
  readonly otherIncome: readonly OtherIncome[];
  readonly expenses: readonly Expense[];
  readonly accounts: readonly Account[];
  readonly contributions: readonly ContributionRule[];
  readonly debts: readonly Debt[];
  readonly properties: readonly Property[];
  readonly rentals: readonly RentalUnit[];
}
declare const validatedPlan: unique symbol;
export type ValidatedPlan = PlanDocument & { readonly [validatedPlan]: true };

