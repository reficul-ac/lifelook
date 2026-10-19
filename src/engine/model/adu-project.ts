import type { AllocationShare, BasisPoints, Cents, History, ISODate, TaxBook, YearMonth } from './plan';

export interface AduTaxSplit {
  readonly buildingBasisCents: Cents;
  readonly currentDeductionCents: Cents;
  readonly nondepreciableBasisCents: Cents;
  readonly nondeductibleExpenseCents: Cents;
}
export type AduBookTreatments = Readonly<Record<TaxBook, History<AduTaxSplit>>>;
export type AduCompletionValuation = Readonly<{kind:'adu-value-per-square-foot'; valuePerSquareFootCents:Cents}> | Readonly<{kind:'value-added'; valueAddedCents:Cents}>;
export interface AduCostStage {
  readonly id:string; readonly name:string; readonly paymentDate:ISODate; readonly amountCents:Cents;
  readonly category:'building'|'land'|'financing-fee'|'other'; readonly treatments:AduBookTreatments;
}
export interface AduDraw {
  readonly id:string; readonly month:YearMonth; readonly amountCents:Cents;
  readonly costAllocations:readonly Readonly<{costId:string;amountCents:Cents}>[];
}
export interface AduInterestTaxRow { readonly id:string; readonly month:YearMonth; readonly treatments:AduBookTreatments }
export interface AduFinancing {
  readonly id:string; readonly name:string; readonly aprBps:BasisPoints;
  readonly firstAmortizingPaymentMonth:YearMonth; readonly termMonths:number;
  readonly collateralPropertyId:string; readonly draws:readonly AduDraw[];
  readonly interestTaxRows:readonly AduInterestTaxRow[];
  readonly proceedsHistoryComplete:History<boolean>; readonly rentalInterestQualified:History<boolean>;
  readonly financingAtRiskQualification:History<boolean>;
}
export interface AduSharedExpenseOverride {readonly id:string; readonly expenseId:string; readonly share?:AllocationShare}
export interface AduTaxPayment {
  readonly id:string; readonly month:YearMonth; readonly amountCents:Cents;
  readonly kind:'regular'|'supplemental'|'construction-in-progress'; readonly treatments:AduBookTreatments;
}
export interface AduPropertyTax {
  readonly addedAssessedValueCents:History<Cents>; readonly marginalRateBps:History<BasisPoints>;
  readonly annualAssessmentGrowthBps:BasisPoints; readonly completedValueEnrollmentYear:number;
  readonly additionalAnnualChargesCents:Cents;
  readonly constructionAssessments:readonly Readonly<{year:number;valueCents:History<Cents>}>[];
  readonly paymentYears:readonly Readonly<{year:number;complete:History<boolean>;payments:readonly AduTaxPayment[]}>[];
  readonly originalExpenseExcludesAdu:History<boolean>;
}
/** Optional planning assumptions; legacy unanswered basic projects may also use estimates. */
export type AduTaxEstimation = Readonly<{mode:'simple';propertyTaxRateBps:BasisPoints}> | Readonly<{mode:'detailed'}>;
export interface AduProject {
  readonly id:string; readonly name:string; readonly rentalId:string;
  readonly constructionStartDate:ISODate; readonly completionDate:ISODate;
  readonly costs:readonly AduCostStage[]; readonly valuation:AduCompletionValuation;
  readonly financing?:AduFinancing; readonly sharedExpenseOverrides:readonly AduSharedExpenseOverride[];
  /** Funds construction costs remaining after attributed financing; omission uses household cash. */
  readonly ownerFunding?:Readonly<{kind:'household-cash'}>|Readonly<{kind:'taxable-brokerage';accountId:string}>;
  readonly propertyTax:AduPropertyTax; readonly taxQualifications:Readonly<Record<TaxBook,History<boolean>>>;
  readonly productionPeriod:History<Readonly<{startDate:ISODate;endDate:ISODate;uninterrupted:boolean}>>;
  readonly supportOperatingDeficits:History<boolean>;
  readonly taxEstimation?:AduTaxEstimation;
}
