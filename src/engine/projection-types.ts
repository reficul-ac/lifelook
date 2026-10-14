import type { AduPeriodProjection } from './property/adu-projection';
import type { CashFlowAllocationYear } from './cash/allocation-types';
import type { Cents } from './model/plan';
import type { Available, Coverage, Issue, RuleProvenance } from './model/results';
import type { HouseholdTaxState } from './model/tax-state';
import type { LoanSchedule } from './property/loans';
import type { CashStream } from './cash/income';
import type { HouseholdTaxResult, HouseholdYear, TaxCandidate } from './tax/comparison';
import type { ContributionRecord } from './tax/facts';
import type { ContributionRequest } from './cash/contribution-requests';
import type { RsuGrantMonth } from './equity/rsu';

export const flowFields = ['grossIncomeCents','salaryCents','otherIncomeCents','rentCents','ordinaryExpensesCents','propertyExpensesCents','expensesCents','debtPaymentCents','interestCents','principalPaidCents','federalIncomeTaxCents','californiaIncomeTaxCents','socialSecurityCents','medicareCents','additionalMedicareCents','sdiCents','totalTaxCents','requestedContributionCents','eligibleContributionCents','preventedContributionCents','accountGrowthCents','propertyGrowthCents','cashFlowCents'] as const;
export const balanceFields = ['accountBalanceCents','propertyValueCents','loanBalanceCents','equityCents','reserveCents','netWorthCents'] as const;
export type MonetaryField = typeof flowFields[number] | typeof balanceFields[number];
export type ProjectionAmounts = Readonly<Record<MonetaryField,Available<Cents>>>;
export type FundingStatus = 'funded' | 'conditional-on-gap' | 'unavailable';
export interface AccountProjection {
  readonly accountId:string;
  readonly openingCents:Available<Cents>;
  readonly contributionCents:Available<Cents>;
  readonly growthCents:Available<Cents>;
  readonly closingCents:Available<Cents>;
  readonly vestedCents?:Available<Cents>;
  readonly withholdingCents?:Available<Cents>;
  readonly conversionInCents?:Available<Cents>;
  readonly conversionOutCents?:Available<Cents>;
}
export interface RsuPeriod {
  readonly taxableIncomeCents:Cents;
  readonly withholdingCents:Cents;
  readonly unvestedValueCents:Cents;
  readonly grants:readonly RsuGrantMonth[];
}
export interface PropertyProjection {
  readonly completionValueAddedCents?:Available<Cents>;
  readonly knownExistingHomeValueCents?:Available<Cents>;
  readonly combinedLivingAreaSqFt?:Available<number>;
  readonly propertyId:string;
  readonly openingValueCents:Available<Cents>;
  readonly growthCents:Available<Cents>;
  readonly closingValueCents:Available<Cents>;
  readonly loanBalanceCents:Available<Cents>;
  readonly equityCents:Available<Cents>;
}
export interface LoanProjection {
  readonly drawCents?:Available<Cents>;
  readonly loanId:string;
  readonly openingPrincipalCents:Available<Cents>;
  readonly interestCents:Available<Cents>;
  readonly paymentCents:Available<Cents>;
  readonly principalPaidCents:Available<Cents>;
  readonly closingPrincipalCents:Available<Cents>;
}
export interface ProjectionMetadata {
  readonly tax:Available<HouseholdTaxResult>;
  readonly household:Available<HouseholdYear>;
  readonly candidates:readonly TaxCandidate[];
  readonly coverage:Coverage;
  readonly provenance:readonly RuleProvenance[];
  readonly issues:readonly Issue[];
}
export interface MonthlyProjection extends ProjectionAmounts,ProjectionMetadata {
  readonly adu?:AduPeriodProjection;
  readonly year:number;
  readonly month:number;
  readonly date:string;
  readonly fundingStatus:FundingStatus;
  readonly conditionalOnGap:boolean;
  readonly accounts:readonly AccountProjection[];
  readonly properties:readonly PropertyProjection[];
  readonly loans:readonly LoanProjection[];
  readonly rsu?:Available<RsuPeriod>;
}
export interface AnnualProjection extends ProjectionAmounts,ProjectionMetadata {
  readonly adu?:AduPeriodProjection;
  readonly cashFlowAllocation?:Available<CashFlowAllocationYear>;
  readonly year:number;
  readonly fundingStatus:FundingStatus;
  readonly conditionalOnGap:boolean;
  readonly accounts:readonly AccountProjection[];
  readonly properties:readonly PropertyProjection[];
  readonly loans:readonly LoanProjection[];
  readonly rsu?:Available<RsuPeriod>;
  readonly ratios:Readonly<{expenseRatio:Available<number>;taxRatio:Available<number>;contributionRatio:Available<number>;cashFlowMargin:Available<number>}>;
}
export interface ProjectionResult {
  readonly planId:string;
  readonly inputRevision:number;
  readonly months:readonly MonthlyProjection[];
  readonly years:readonly AnnualProjection[];
  readonly contributions:readonly ContributionRecord[];
  readonly contributionSchedules:readonly Readonly<{ruleId:string;year:number;requests:Available<readonly ContributionRequest[]>}>[];
  readonly taxStates:readonly Readonly<{year:number;opening:HouseholdTaxState;closing:HouseholdTaxState}>[];
  readonly loanSchedules:readonly Readonly<{loanId:string;year:number;schedule:Available<LoanSchedule>}>[];
  readonly cashSchedules:readonly Readonly<{recordId:string;year:number;kind:CashStream['kind'];schedule:Available<CashStream>}>[];
  readonly rsuSchedules?:readonly Readonly<{accountId:string;year:number;schedule:Available<readonly RsuGrantMonth[]>}>[];
  readonly openingTaxState:HouseholdTaxState;
  readonly closingTaxState:HouseholdTaxState;
  readonly provenance:readonly RuleProvenance[];
  readonly coverage:Coverage;
  readonly issues:readonly Issue[];
}
