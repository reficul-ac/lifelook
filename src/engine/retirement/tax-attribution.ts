import type {Cents} from '../model/plan';
import type {Available,RuleProvenance} from '../model/results';
import type {HouseholdTaxState} from '../model/tax-state';
import {evaluateFixedHouseholdTaxYear,type FixedHouseholdTaxYearResult} from '../tax/comparison';
import {combineAvailableCents} from '../tax/modified-income';
import type {ResolvedRetirementTaxYear} from './tax-facts';
import type {DistributionYearResult} from './distributions';
export interface AcceptedRetirementTaxYear {readonly schedule:DistributionYearResult;readonly recurring:ResolvedRetirementTaxYear;readonly mandatoryExcess:ResolvedRetirementTaxYear;readonly complete:ResolvedRetirementTaxYear}
export interface RetirementTaxAttribution {
 readonly recurringCents:Available<Cents>;readonly mandatoryExcessCents:Available<Cents>;readonly transitionCents:Available<Cents>;readonly totalCents:Available<Cents>;
 readonly closingTaxState:HouseholdTaxState;readonly provenance:Available<RuleProvenance>;readonly complete:FixedHouseholdTaxYearResult;
}
/** A/B/C compare three fixed views of one accepted schedule; no funding or basis resolver is invoked. */
export function attributeRetirementTax(input:AcceptedRetirementTaxYear):RetirementTaxAttribution {
 if([input.recurring,input.mandatoryExcess,input.complete].some(v=>v.acceptedDistributions!==input.schedule))throw new RangeError('Counterfactual views must share one accepted distribution schedule.');
 if(input.recurring.taxScope!=='recurring'||input.mandatoryExcess.taxScope!=='mandatory-excess'||input.complete.taxScope!=='transition')throw new RangeError('Counterfactual tax scope mismatch.');
 const A=evaluateFixedHouseholdTaxYear(input.recurring),B=evaluateFixedHouseholdTaxYear(input.mandatoryExcess),C=evaluateFixedHouseholdTaxYear(input.complete);
 const amount=(r:FixedHouseholdTaxYearResult):Available<Cents>=>r.tax.status==='available'?{status:'available',value:r.tax.value.combinedIncomeTaxCents}:r.tax;
 const a=amount(A),b=amount(B),c=amount(C);
 return {recurringCents:a,mandatoryExcessCents:combineAvailableCents([b,a],v=>v[0]!-v[1]!),transitionCents:combineAvailableCents([c,b],v=>v[0]!-v[1]!),totalCents:c,closingTaxState:C.closingTaxState,provenance:C.tax.status==='available'?{status:'available',value:C.tax.value.provenance}:C.tax,complete:C};
}
