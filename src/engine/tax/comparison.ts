import type { ContributionRequest } from '../cash/contribution-requests';
import type { CashYear } from '../cash/income';
import { checkCoverage, rsuDeferredTaxIssues } from '../coverage';
import { Decimal, settleCents } from '../money';
import type { Cents, History, ValidatedPlan } from '../model/plan';
import type { Available, Coverage, Issue, RuleProvenance } from '../model/results';
import type { HouseholdTaxState } from '../model/tax-state';
import type { PropertyYearFacts } from '../property/facts';
import {finishAduTaxYear} from '../property/adu-tax';
import {aduEstimateProvenance} from '../property/adu-planning-estimates';
import type { LoanSchedule } from '../property/loans';
import type { YearRules } from '../rules/types';
import { calculateCaliforniaTax, type CaliforniaTaxResult } from './california';
import { calculateFederalTax, resolveRentalQbi, type FederalTaxResult } from './federal';
import { buildResolvedTaxFacts, type ContributionRecord, type IraYear, type ResolvedTaxFacts } from './facts';
import { resolveIraContributions } from './ira';
import { buildItemizedCandidate, standardDeduction, type DeductionChoice, type ItemizedDetail, type StateTaxPaid } from './itemized';
import { buildPreIraFacts } from './modified-income';
import { calculateMortgageDeduction } from './mortgage';
import { calculatePayroll, type PayrollYear } from './payroll';
import { resolveRentalLosses, type RentalLossYear } from './rental-losses';
import { resolveWorkplaceContributions } from './workplace';

export type DeductionMethod='standard'|'itemized';
export interface TaxCandidate {
  readonly id:string;
  readonly federalMethod:DeductionMethod;
  readonly californiaMethod:DeductionMethod;
  readonly federal:Available<FederalTaxResult>;
  readonly california:Available<CaliforniaTaxResult>;
  readonly statePaid:Available<StateTaxPaid>;
  readonly combinedIncomeTaxCents:Available<Cents>;
  readonly deductions:Readonly<{federal:Available<DeductionChoice>;california:Available<DeductionChoice>}>;
}
export interface HouseholdTaxResult {
  readonly year:number;
  readonly federal:FederalTaxResult;
  readonly california:CaliforniaTaxResult;
  readonly combinedIncomeTaxCents:Cents;
  readonly selectedMethods:Readonly<{federal:DeductionMethod;california:DeductionMethod}>;
  readonly statePaid:StateTaxPaid;
  readonly deductions:Readonly<{federal:DeductionChoice;california:DeductionChoice}>;
  readonly provenance:RuleProvenance;
}
export interface HouseholdYear {
  readonly year:number;
  readonly contributions:readonly ContributionRecord[];
  readonly payroll:PayrollYear;
  readonly tax:Available<HouseholdTaxResult>;
  readonly candidates:readonly TaxCandidate[];
  readonly facts:ResolvedTaxFacts;
  readonly rental:RentalLossYear;
  readonly ira:IraYear;
  readonly closingTaxState:HouseholdTaxState;
  readonly coverage:Coverage;
  readonly issues:readonly Issue[];
}

function missingFrom<T>(values:readonly Available<unknown>[]):Available<T>|undefined {
  const missing=values.filter(v=>v.status!=='available');
  return missing.length?{status:missing.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:missing.flatMap(v=>v.issues)}:undefined;
}
const available=<T>(value:T):Available<T>=>({status:'available',value});
export function combineProvenance(rules:YearRules,values:readonly RuleProvenance[]):RuleProvenance {
  return {status:values.some(p=>p.status==='provisional')?'provisional':values.some(p=>p.status==='projected')?'projected':'verified',ruleVersion:rules.ruleVersion,baselineYear:rules.baselineYear,applicableYear:rules.year,sources:[...new Set(values.flatMap(p=>p.sources))],assumptions:[...new Set(values.flatMap(p=>p.assumptions))]};
}
function deductionChoice(method:DeductionMethod,standard:Available<Cents>,detail:Available<ItemizedDetail>):Available<DeductionChoice> {
  if(method==='standard') {
    if(standard.status!=='available')return standard;
    return available({method,standardCents:standard.value,allowedItemizedCents:detail.status==='available'?detail.value.allowedCents:0,...(detail.status==='available'?{detail:detail.value}:{})});
  }
  if(detail.status!=='available')return detail;
  return available({method,standardCents:standard.status==='available'?standard.value:0,allowedItemizedCents:detail.value.allowedCents,detail:detail.value});
}
function unsupportedCoverage(plan:ValidatedPlan,year:number):Available<never>|undefined {
  const fields=['additionalIncome','additionalCredits','qualifiedDividendsOrCapitalGains'] as const;
  const rsuIssues=rsuDeferredTaxIssues(plan,year);
  const issues:Issue[]=[...rsuIssues,...fields.flatMap(field=>{
    const h=plan.household.coverageAnswers[field];
    return !h.known||h.value?[{code:h.known?'unsupported-tax-case':'required-tax-coverage',recordId:plan.id,year,field:`household.coverageAnswers.${field}`,severity:'warning' as const,explanation:h.known?'A reported material income or credit circumstance lies outside this calculation contract.':'The absence of additional material income or credits has not been established.',resolution:'Confirm the covered household circumstances or extend the sourced calculation before relying on a total.'}]:[];
  })];
  if(!issues.length)return undefined;
  return {status:rsuIssues.length||fields.some(field=>{const h=plan.household.coverageAnswers[field];return h.known&&h.value;})?'unsupported-case':'needs-data',issues};
}

/** Resolve annual eligibility first; compare complete legal tax candidates without mutation. */
export function resolveHouseholdYear(plan:ValidatedPlan,cash:CashYear,requests:readonly ContributionRequest[],property:PropertyYearFacts,loans:readonly LoanSchedule[],opening:HouseholdTaxState,rules:YearRules):HouseholdYear {
  opening=property.adu?.opening??opening;
  const workplace=resolveWorkplaceContributions(plan,cash,requests,rules);
  const payroll=calculatePayroll(cash,workplace,rules);
  const preIra=buildPreIraFacts(cash,workplace,property);
  const rental=resolveRentalLosses(preIra,opening,rules);
  const ira=resolveIraContributions(plan,preIra,rental,requests,workplace,rules);
  const facts=buildResolvedTaxFacts(preIra,rental,ira,workplace);
  const mortgages={federal:calculateMortgageDeduction(property,loans,'federal',rules),california:calculateMortgageDeduction(property,loans,'california',rules)};
  const federalStandard=standardDeduction(plan.household.filers,cash.year,'federal',rules);
  const californiaStandard=standardDeduction(plan.household.filers,cash.year,'california',rules);
  const override=plan.taxPolicy.actualStateTaxPaidByYear.find(o=>o.year===cash.year);
  const unavailableStatePaid:Available<StateTaxPaid>={status:'needs-data',issues:[{code:'candidate-state-payment-pending',year:cash.year,field:'statePaid',severity:'info',explanation:'Prospective paid California tax depends on the California candidate.',resolution:'Resolve the California candidate before computing federal paid-tax deductions.'}]};
  const caItemized=buildItemizedCandidate(facts,property,mortgages,unavailableStatePaid,rules).california;
  const candidates:TaxCandidate[]=[];
  for(const caMethod of ['standard','itemized'] as const) {
    const caChoice=deductionChoice(caMethod,californiaStandard,caItemized);
    const caTax:Available<CaliforniaTaxResult>=caChoice.status==='available'?calculateCaliforniaTax(facts,caChoice.value,opening,rules):caChoice;
    const statePaid:Available<StateTaxPaid>=override?available({californiaIncomeTaxPaidCents:override.californiaIncomeTaxPaidCents,sdiPaidCents:override.sdiPaidCents,source:'actual-override' as const}):caTax.status==='available'?available({californiaIncomeTaxPaidCents:caTax.value.totalCents,sdiPaidCents:payroll.annual.sdiCents,source:'prospective-assumption' as const,provenance:combineProvenance(rules,[caTax.value.provenance,...payroll.provenance])}):caTax;
    const fedItemized=buildItemizedCandidate(facts,property,mortgages,statePaid,rules).federal;
    for(const fedMethod of ['standard','itemized'] as const) {
      const fedChoice=deductionChoice(fedMethod,federalStandard,fedItemized);
      const fedTax:Available<FederalTaxResult>=fedChoice.status==='available'?calculateFederalTax(facts,fedChoice.value,opening,rules):fedChoice;
      const unavailable=missingFrom<Cents>([fedTax,caTax]);
      const combinedIncomeTaxCents:Available<Cents>=unavailable??(fedTax.status==='available'&&caTax.status==='available'?available(settleCents(new Decimal(fedTax.value.totalCents).plus(caTax.value.totalCents))):{status:'needs-data',issues:[]});
      candidates.push({id:`${fedMethod}-${caMethod}`,federalMethod:fedMethod,californiaMethod:caMethod,federal:fedTax,california:caTax,statePaid,combinedIncomeTaxCents,deductions:{federal:fedChoice,california:caChoice}});
    }
  }
  candidates.sort((a,b)=>{
    if(a.combinedIncomeTaxCents.status!=='available'||b.combinedIncomeTaxCents.status!=='available')return a.id<b.id?-1:a.id>b.id?1:0;
    const delta=a.combinedIncomeTaxCents.value-b.combinedIncomeTaxCents.value;
    const count=(c:TaxCandidate)=>(c.federalMethod==='standard'?1:0)+(c.californiaMethod==='standard'?1:0);
    return delta||count(b)-count(a)||(a.federalMethod==='standard'?-1:1)-(b.federalMethod==='standard'?-1:1);
  });
  const blocked=unsupportedCoverage(plan,cash.year)??missingFrom<HouseholdTaxResult>(candidates.map(c=>c.combinedIncomeTaxCents));
  const selected=blocked?undefined:candidates[0];
  let tax:Available<HouseholdTaxResult>;
  if(blocked)tax=blocked;
  else if(selected?.federal.status==='available'&&selected.california.status==='available'&&selected.statePaid.status==='available'&&selected.combinedIncomeTaxCents.status==='available'&&selected.deductions.federal.status==='available'&&selected.deductions.california.status==='available') {
    tax=available({year:cash.year,federal:selected.federal.value,california:selected.california.value,combinedIncomeTaxCents:selected.combinedIncomeTaxCents.value,selectedMethods:{federal:selected.federalMethod,california:selected.californiaMethod},statePaid:selected.statePaid.value,deductions:{federal:selected.deductions.federal.value,california:selected.deductions.california.value},provenance:combineProvenance(rules,[selected.federal.value.provenance,selected.california.value.provenance,...(plan.properties.some(p=>p.aduProject?.taxEstimation?.mode==='simple')?[aduEstimateProvenance(cash.year)]:[])])});
  } else tax={status:'needs-data',issues:[{code:'unavailable-tax-choice',year:cash.year,severity:'warning',explanation:'No complete legal tax candidate is available.',resolution:'Resolve the located tax and deduction inputs.'}]};
  const priorities=new Map(plan.contributions.map(r=>[r.id,r.priority]));
  const contributions=[...workplace.records,...ira.records].sort((a,b)=>a.month-b.month||(priorities.get(a.ruleId)??0)-(priorities.get(b.ruleId)??0)||(a.ruleId<b.ruleId?-1:a.ruleId>b.ruleId?1:0));
  const credit=(jurisdiction:'federal'|'california'):History<boolean>=>{
    if(tax.status==='available')return tax.value[jurisdiction].closingState.minimumTaxCreditCoverage[jurisdiction];
    const prior=opening.minimumTaxCreditCoverage[jurisdiction];
    if(prior.known&&prior.value)return prior;
    const possible=candidates.map(c=>c[jurisdiction]);
    if(possible.some(c=>c.status!=='available'))return {known:false};
    const markers=possible.map(c=>c.status==='available'?c.value.closingState.minimumTaxCreditCoverage[jurisdiction]:{known:false} as const);
    const first=markers[0];return first?.known&&markers.every(h=>h.known&&h.value===first.value)?first:{known:false};
  };
  const closingRentals=Object.fromEntries(Object.entries(rental.closing.rentals).map(([id,books])=>[id,{...books}]));
  if(tax.status==='available')for(const id of Object.keys(closingRentals)) {
    for(const book of ['federal','federal-amt'] as const){const state=tax.value.federal.closingState.rentals[id]?.[book];if(state)closingRentals[id]![book]=state;}
    for(const book of ['california','california-amt'] as const){const state=tax.value.california.closingState.rentals[id]?.[book];if(state)closingRentals[id]![book]=state;}
  }
  const qbi=resolveRentalQbi(facts,opening,rules);
  const carriedTaxState:HouseholdTaxState={...rental.closing,year:cash.year,rentals:closingRentals,iraBasisByOwner:ira.closingIraBasisByOwner,qbiLossVintages:qbi.status==='available'?qbi.value.closingLossVintagesByRental:Object.fromEntries(Object.keys(rental.closing.qbiLossVintages).map(id=>[id,{known:false} as const])),minimumTaxCreditCoverage:{federal:credit('federal'),california:credit('california')}};
  const closingTaxState=property.adu?finishAduTaxYear(property.adu,carriedTaxState):carriedTaxState;
  const baseCoverage=checkCoverage(plan,cash.year);
  const issueList=[...workplace.issues,...rental.issues,...ira.issues,...facts.issues,...baseCoverage.issues,...(tax.status==='available'?[...tax.value.federal.issues,...tax.value.california.issues]:tax.issues)];
  if(tax.status==='available'&&tax.value.provenance.status!=='verified')issueList.push({code:tax.value.provenance.status==='provisional'?'provisional-rules':'projected-rules',year:cash.year,severity:tax.value.provenance.status==='provisional'?'warning':'info',explanation:`This numerical tax scenario uses ${tax.value.provenance.status} sourced rules and explicit assumptions.`,resolution:'Inspect the tax explanation and source register; rerun fixtures when final applicable publications are available.'});
  const issues=[...new Map(issueList.map(i=>[JSON.stringify(i),i])).values()];
  const coverage:Coverage={completeForModeledScope:baseCoverage.completeForModeledScope&&tax.status==='available',completeHouseholdLiability:baseCoverage.completeHouseholdLiability&&tax.status==='available',issues:issues.filter(i=>i.code!=='provisional-rules'&&i.code!=='projected-rules')};
  return {year:cash.year,contributions,payroll,tax,candidates,facts,rental,ira,closingTaxState,coverage,issues};
}
