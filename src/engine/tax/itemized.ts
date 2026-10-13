import type { Cents, Filer, History } from '../model/plan';
import type { Available, Issue, RuleProvenance } from '../model/results';
import type { YearRules } from '../rules/types';
import { Decimal, settleCents } from '../money';
import type { PropertyYearFacts } from '../property/facts';
import type { MortgageDeductions } from './mortgage';
import { aggregateRuleProvenance, mergeRuleProvenance } from '../rules/projection';
import type { ResolvedTaxFacts } from './facts';
export interface StateTaxPaid { readonly californiaIncomeTaxPaidCents:Cents;readonly sdiPaidCents:Cents;readonly source:'prospective-assumption'|'actual-override';readonly provenance?:RuleProvenance }
export interface ItemizedDetail {
  readonly jurisdiction:'federal'|'california';readonly originalCents:Cents;readonly allowedCents:Cents;readonly disallowedCents:Cents;
  readonly mortgageInterestCents:Cents;readonly mortgageInsuranceCents:Cents;readonly saltCents:Cents;readonly propertyTaxPaidCents:Cents;
  readonly statePaid?:StateTaxPaid;readonly niitDeductionCents:Available<Cents>;readonly amtAllowedCents:Cents;readonly provenance:RuleProvenance;readonly reasons:readonly Issue[];
}
export interface ItemizedCandidate { readonly federal:Available<ItemizedDetail>;readonly california:Available<ItemizedDetail> }
export interface DeductionChoice {readonly method:'standard'|'itemized';readonly standardCents:Cents;readonly allowedItemizedCents:Cents;readonly detail?:ItemizedDetail}
/** Narrow structural prerequisite until the annual facts producer is published. */
export interface ItemizedFacts {readonly year:number;readonly federalAgiCents:Available<Cents>;readonly saltMagiCents:Available<Cents>;readonly niitOtherIncomeCents:Available<Cents>;readonly rental:{readonly federal:Available<{readonly allowedRentalCents:Cents}>}}
export function standardDeduction(filers:readonly Filer[],year:number,jurisdiction:'federal'|'california',rules:YearRules):Available<Cents>{
  if(jurisdiction==='california')return {status:'available',value:rules.california.standardDeductionCents};
  const unknown=filers.filter(f=>!f.birthDate.known);
  if(unknown.length)return {status:'needs-data',issues:unknown.map(f=>({code:'required-filer-age',recordId:f.id,year,field:'birthDate',severity:'warning',explanation:'Federal standard deduction additions depend on the filer age.',resolution:'Supply a birth date to determine the age-related deduction.'}))};
  const cutoff=`${String(year-rules.federal.ageDeductionMinimumAge+1).padStart(4,'0')}-01-01`;
  const aged=filers.filter(f=>f.birthDate.known&&f.birthDate.value<=cutoff).length;
  return {status:'available',value:settleCents(new Decimal(rules.federal.standardDeductionCents).plus(new Decimal(rules.federal.additionalStandardDeductionPerFilerCents).mul(aged)))};
}
export function federalSaltDeduction(eligiblePaidCents:Cents,modifiedIncomeCents:Cents,rules:YearRules):Cents{
  const r=rules.federal.salt;
  const reduced=new Decimal(r.capCents).minus(Decimal.max(0,new Decimal(modifiedIncomeCents).minus(r.phaseoutStartCents)).mul(r.reductionBps).div(10000));
  return settleCents(Decimal.min(eligiblePaidCents,Decimal.max(r.floorCents,reduced)));
}
/** preRestrictionTaxableCents is taxable income AFTER itemized/QBI/other deductions, but WITHOUT section68. */
export function limitFederalItemized(itemizedCents:Cents,preRestrictionTaxableCents:Cents,rules:YearRules):Cents{
  const r=rules.federal.itemized;
  const excess=Decimal.max(0,new Decimal(preRestrictionTaxableCents).plus(itemizedCents).minus(r.thresholdCents));
  const reduction=Decimal.min(itemizedCents,excess).mul(r.restrictionNumerator).div(r.restrictionDenominator);
  return settleCents(new Decimal(itemizedCents).minus(reduction));
}
export function buildItemizedCandidate(facts:ResolvedTaxFacts,property:PropertyYearFacts,mortgages:MortgageDeductions,statePaid:Available<StateTaxPaid>,rules:YearRules):ItemizedCandidate;
export function buildItemizedCandidate(facts:ItemizedFacts,property:PropertyYearFacts,mortgages:MortgageDeductions,statePaid:Available<StateTaxPaid>,rules:YearRules):ItemizedCandidate;
export function buildItemizedCandidate(facts:ItemizedFacts,property:PropertyYearFacts,mortgages:MortgageDeductions,statePaid:Available<StateTaxPaid>,rules:YearRules):ItemizedCandidate{
  const reason=(code:string,explanation:string):Issue=>({code,year:facts.year,severity:'info',explanation,resolution:'Review the independently qualified personal deduction details and paid-tax assumptions.'});
  function unavailable<T>(inputs:readonly Available<unknown>[]):Available<T>|undefined{
    const missing=inputs.filter(v=>v.status!=='available');
    if(!missing.length)return undefined;
    return {status:missing.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:missing.flatMap(v=>v.issues)};
  }
  const personal=property.personal;
  const caMissing=unavailable<ItemizedDetail>([mortgages.california,facts.federalAgiCents]);
  let california:Available<ItemizedDetail>;
  if(caMissing)california=caMissing;
  else {
    if(mortgages.california.status!=='available'||facts.federalAgiCents.status!=='available')throw new Error('Unreachable available CA inputs');
    const mortgage=mortgages.california.value;
    const before=new Decimal(mortgage.allowedInterestCents).plus(personal.propertyTaxPaidCents);
    const excess=Decimal.max(0,new Decimal(facts.federalAgiCents.value).minus(rules.california.itemized.phaseoutStartCents));
    const reduction=Decimal.min(before.mul(rules.california.itemized.maxReductionBps).div(10000),excess.mul(rules.california.itemized.reductionBps).div(10000));
    const allowed=settleCents(before.minus(reduction));
    const original=settleCents(new Decimal(mortgage.paidInterestCents).plus(personal.propertyTaxPaidCents).plus(personal.mortgageInsuranceCents).plus(personal.homeownersInsuranceCents));
    const reasons=[...mortgage.issues];
    if(personal.homeownersInsuranceCents)reasons.push(reason('personal-homeowners-insurance','Personal homeowner insurance does not qualify as an itemized deduction.'));
    if(personal.mortgageInsuranceCents)reasons.push(reason('california-mortgage-insurance-excluded','California does not allow personal mortgage insurance premiums.'));
    reasons.push(reason('california-state-tax-excluded','California excludes personal state income tax and SDI from its deduction path.'));
    if(reduction.gt(0))reasons.push(reason('california-high-income-itemized-reduction','California applies its own 6% AGI-excess reduction capped at 80% of subject deductions.'));
    const ruleProvenance=aggregateRuleProvenance(rules,['california.mortgage.acquisitionLimitCents','california.mortgageInsurance.allowed','california.itemized.phaseoutStartCents','california.itemized.reductionBps','california.itemized.maxReductionBps']);
    const provenance=mergeRuleProvenance(rules,[ruleProvenance,mortgage.provenance]);
    california={status:'available',value:{jurisdiction:'california',originalCents:original,allowedCents:allowed,disallowedCents:settleCents(new Decimal(original).minus(allowed)),mortgageInterestCents:mortgage.allowedInterestCents,mortgageInsuranceCents:0,saltCents:personal.propertyTaxPaidCents,propertyTaxPaidCents:personal.propertyTaxPaidCents,niitDeductionCents:{status:'available',value:0},amtAllowedCents:mortgage.allowedInterestCents,provenance,reasons}};
  }
  const fedMissing=unavailable<ItemizedDetail>([mortgages.federal,facts.federalAgiCents,facts.saltMagiCents,statePaid]);
  let federal:Available<ItemizedDetail>;
  if(fedMissing)federal=fedMissing;
  else {
    if(mortgages.federal.status!=='available'||facts.federalAgiCents.status!=='available'||facts.saltMagiCents.status!=='available'||statePaid.status!=='available')throw new Error('Unreachable available federal inputs');
    const mortgage=mortgages.federal.value;
    let qualifiedMpi=new Decimal(0), trackedMpi=new Decimal(0);
    const mpiIssues:Issue[]=[];
    for(const expense of property.expenses.filter(e=>e.taxCategory==='mortgage-insurance'&&e.personalCents>0)){
      const q=(expense as typeof expense & {readonly mortgageInsuranceQualification?:History<boolean>}).mortgageInsuranceQualification;
      trackedMpi=trackedMpi.plus(expense.personalCents);
      if(!q?.known)mpiIssues.push({...reason('required-mortgage-insurance-qualification','A personal mortgage insurance premium lacks explicit eligible-contract/type/acquisition-debt qualification.'),recordId:expense.expenseId,field:'mortgageInsuranceQualification',severity:'warning'});
      else if(q.value)qualifiedMpi=qualifiedMpi.plus(expense.personalCents);
    }
    if(trackedMpi.lt(personal.mortgageInsuranceCents))mpiIssues.push({...reason('required-mortgage-insurance-qualification','A positive personal mortgage insurance total lacks expense-level qualification evidence.'),field:'mortgageInsuranceQualification',severity:'warning'});
    if(mpiIssues.length)federal={status:'needs-data',issues:mpiIssues};
    else {
      const mipRule=rules.federal.mortgageInsurance;
      const steps=Decimal.max(0,new Decimal(facts.federalAgiCents.value).minus(mipRule.phaseoutStartCents)).div(mipRule.phaseoutStepCents).ceil();
      const mip=settleCents(qualifiedMpi.mul(Decimal.max(0,new Decimal(1).minus(steps.mul(mipRule.reductionBps).div(10000)))));
      const eligiblePaid=settleCents(new Decimal(personal.propertyTaxPaidCents).plus(statePaid.value.californiaIncomeTaxPaidCents).plus(statePaid.value.sdiPaidCents));
      const salt=federalSaltDeduction(eligiblePaid,facts.saltMagiCents.value,rules);
      const allowed=settleCents(new Decimal(mortgage.allowedInterestCents).plus(mip).plus(salt));
      const original=settleCents(new Decimal(mortgage.paidInterestCents).plus(personal.mortgageInsuranceCents).plus(personal.homeownersInsuranceCents).plus(eligiblePaid));
      const niiMissing=unavailable<Cents>([facts.niitOtherIncomeCents,facts.rental.federal]);
      let niitDeductionCents:Available<Cents>;
      if(niiMissing)niitDeductionCents=niiMissing;
      else {
        if(facts.niitOtherIncomeCents.status!=='available'||facts.rental.federal.status!=='available')throw new Error('Unreachable available NII inputs');
        const nii=Decimal.max(0,new Decimal(facts.niitOtherIncomeCents.value).plus(facts.rental.federal.value.allowedRentalCents));
        const share=facts.federalAgiCents.value<=0?new Decimal(0):Decimal.min(1,nii.div(facts.federalAgiCents.value));
        // Form8960 reasonable proportional allocation; SDI paid on wages and personal real estate taxes are excluded.
        const allowedStateTax=eligiblePaid===0?new Decimal(0):new Decimal(statePaid.value.californiaIncomeTaxPaidCents).mul(salt).div(eligiblePaid);
        niitDeductionCents={status:'available',value:settleCents(allowedStateTax.mul(share))};
      }
      const reasons=[...mortgage.issues];
      if(personal.homeownersInsuranceCents)reasons.push(reason('personal-homeowners-insurance','Personal homeowner insurance does not qualify as an itemized deduction.'));
      if(mip<personal.mortgageInsuranceCents)reasons.push(reason('mortgage-insurance-phaseout-or-unqualified','Mortgage insurance must be explicitly qualified and follows the separate AGI step phaseout.'));
      if(salt<eligiblePaid)reasons.push(reason('salt-cap-or-phaseout','SALT payments exceed the independently phased household cap.'));
      const ruleProvenance=aggregateRuleProvenance(rules,['federal.mortgage.post2017LimitCents','federal.mortgage.pre2017LimitCents','federal.mortgageInsurance.allowed','federal.mortgageInsurance.phaseoutStartCents','federal.mortgageInsurance.phaseoutStepCents','federal.mortgageInsurance.reductionBps','federal.salt.capCents','federal.salt.phaseoutStartCents','federal.salt.reductionBps','federal.salt.floorCents']);
      const provenance=mergeRuleProvenance(rules,[ruleProvenance,mortgage.provenance,...(statePaid.value.provenance?[statePaid.value.provenance]:[])]);
      federal={status:'available',value:{jurisdiction:'federal',originalCents:original,allowedCents:allowed,disallowedCents:settleCents(new Decimal(original).minus(allowed)),mortgageInterestCents:mortgage.allowedInterestCents,mortgageInsuranceCents:mip,saltCents:salt,propertyTaxPaidCents:personal.propertyTaxPaidCents,statePaid:statePaid.value,niitDeductionCents,amtAllowedCents:settleCents(new Decimal(mortgage.allowedInterestCents).plus(mip)),provenance,reasons}};
    }
  }
  return {federal,california};
}
