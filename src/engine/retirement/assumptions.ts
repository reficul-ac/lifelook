import type {ValidatedPlan} from '../model/plan';
import type {RuleProvenance} from '../model/results';
import {RETIREMENT_PLANNING_VERSION,type ValidatedRetirementAnalysis} from './definition';
export interface RetirementAssumptionFact {readonly recordId:string;readonly field:string;readonly value:number|string|boolean;readonly origin:'entered-history'|'estimate';readonly explanation:string}
export interface ResolvedRetirementAssumptions {readonly facts:readonly RetirementAssumptionFact[];readonly provenance:RuleProvenance}
/** Resolve unanswered facts without rewriting the source's history. */
export function resolveRetirementAssumptions(source:ValidatedPlan,definition:ValidatedRetirementAnalysis):ResolvedRetirementAssumptions {
 const facts:RetirementAssumptionFact[]=[];
 for(const account of source.accounts){
  const override=definition.assumptions.accounts.find(a=>a.accountId===account.id);
  if(account.type==='taxable-brokerage'){
   const history=account.openingTaxableBasis,estimate=override?.taxableBasisCents;
   facts.push({recordId:account.id,field:'taxableBasisCents',value:history?.known?history.value:estimate?.known?estimate.value:0,origin:history?.known?'entered-history':'estimate',explanation:history?.known?'Entered opening investment basis.':'Unanswered investment basis uses the retirement override or conservative zero-basis estimate.'});
  }
 }
 for(const owner of source.household.filers){
  const estimate=definition.assumptions.owners.find(o=>o.ownerId===owner.id)?.birthDate;
  if(owner.birthDate.known||estimate?.known)facts.push({recordId:owner.id,field:'birthDate',value:owner.birthDate.known?owner.birthDate.value:estimate!.known?estimate!.value:'',origin:owner.birthDate.known?'entered-history':'estimate',explanation:owner.birthDate.known?'Entered date of birth.':'Explicit retirement-only date assumption.'});
 }
 facts.push({recordId:source.id,field:'noFederalSaltBenefitForCaliforniaAdditionalTax',value:definition.assumptions.noFederalSaltBenefitForCaliforniaAdditionalTax,origin:'estimate',explanation:'No federal SALT benefit modeled for California early-distribution additional tax.'});
 return {facts,provenance:{status:'projected',ruleVersion:RETIREMENT_PLANNING_VERSION,baselineYear:2026,applicableYear:source.startYear,sources:[],assumptions:facts.filter(f=>f.origin==='estimate').map(f=>f.explanation)}};
}
