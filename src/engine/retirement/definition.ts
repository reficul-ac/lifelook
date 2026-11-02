import type {BasisPoints,Cents,History,ISODate,PlanDocument,TaxBook} from '../model/plan';
export const RETIREMENT_PLANNING_VERSION='retirement-planning-v1';
export const retirementPresets={sellingCostBps:600,buyingCostBps:200,buildingShareBps:8000,downPaymentBps:2000,termMonths:360} as const;
export interface RetirementRentalBudget {readonly monthlyRentCents?:Cents;readonly vacancyBps?:BasisPoints;readonly rentGrowthBps?:BasisPoints;readonly annualOperatingCostsCents:Cents}
export interface NewRetirementProperty extends RetirementRentalBudget {
 readonly id:string;readonly name:string;readonly use:'personal'|'rental';readonly purchasePriceCents:Cents;readonly appreciationBps:BasisPoints;readonly buyingCostBps?:BasisPoints;readonly capitalizedBuyingCostBps?:BasisPoints;
 readonly financing:Readonly<{kind:'cash'}>|Readonly<{kind:'mortgage';downPaymentBps:BasisPoints;aprBps:BasisPoints;termMonths:number}>;
}
export interface ExistingRetirementProperty {
 readonly propertyId:string;readonly action:'keep'|'convert-to-rental'|'sell';readonly payoffLoanIds:readonly string[];
 readonly payoffFeesCents?:Cents;readonly salePriceCents?:Cents;readonly sellingCostBps?:BasisPoints;
 readonly conversion?:RetirementRentalBudget;
}
export interface RetirementPropertyAssumption {
 readonly propertyId:string;readonly buildingShareBps?:BasisPoints;readonly improvementsCents?:History<Cents>;
 readonly adjustedBasisByBook?:Readonly<Partial<Record<TaxBook,History<Cents>>>>;
 readonly priorDepreciationByBook?:Readonly<Partial<Record<TaxBook,History<Cents>>>>;
 readonly homeExclusionEligible?:History<boolean>;readonly activityId?:string;readonly zero1231Lookback?:History<boolean>;
}
export interface RetirementAccountAssumption {
 readonly accountId:string;readonly taxableBasisCents?:History<Cents>;readonly californiaBasisCents?:History<Cents>;
 readonly rothContributionBasisCents?:History<Cents>;readonly rothFirstContributionYear?:History<number>;
 readonly conversionLayers?:readonly Readonly<{year:number;taxableCents:Cents;nontaxableCents:Cents}>[];
 readonly separationDate?:History<ISODate>;
}
export interface RetirementOwnerAssumption {readonly ownerId:string;readonly birthDate?:History<ISODate>;readonly federalIraBasisCents?:History<Cents>;readonly californiaIraBasisCents?:History<Cents>;readonly californiaPre1987BasisCents?:History<Cents>;readonly rmdAgeAssumption?:History<73|75>}
export interface RetirementAssumptions {
 readonly properties:readonly RetirementPropertyAssumption[];readonly accounts:readonly RetirementAccountAssumption[];readonly owners:readonly RetirementOwnerAssumption[];
 readonly sellingCostBps:BasisPoints;readonly buyingCostBps:BasisPoints;readonly buildingShareBps:BasisPoints;
 readonly noFederalSaltBenefitForCaliforniaAdditionalTax:boolean;
}
export interface RetirementAnalysisDefinition {
 readonly schemaVersion:1;readonly mode:'projected'|'reallocate';readonly withdrawalBps:BasisPoints;readonly stockGrowthBps?:BasisPoints;
 readonly existingProperties:readonly ExistingRetirementProperty[];readonly newProperties:readonly NewRetirementProperty[];
 readonly assumptions:RetirementAssumptions;readonly commitments:readonly Readonly<{recordId:string;action:'continue'|'exclude'}>[];
}
declare const validatedRetirementAnalysis:unique symbol;
export type ValidatedRetirementAnalysis=RetirementAnalysisDefinition & {readonly [validatedRetirementAnalysis]:true};
export function createDefaultRetirementAnalysis(source:PlanDocument):RetirementAnalysisDefinition {
 const stockGrowthBps=source.growthAssumptions?.stocksBps;
 return {schemaVersion:1,mode:'projected',withdrawalBps:300,...(stockGrowthBps===undefined?{}:{stockGrowthBps}),existingProperties:[],newProperties:[],commitments:[],assumptions:{properties:[],accounts:[],owners:[],sellingCostBps:600,buyingCostBps:200,buildingShareBps:8000,noFederalSaltBenefitForCaliforniaAdditionalTax:true}};
}
