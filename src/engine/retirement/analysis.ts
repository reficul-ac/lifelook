import type {Cents,ValidatedPlan} from '../model/plan';
import type {Available,Issue,RuleProvenance} from '../model/results';
import type {RuleSet} from '../rules/types';
import type {ForecastCheckpoint,ForecastContext} from '../forecast/types';
import {createForecastContext} from '../forecast/context';
import {projectWithCheckpoints} from '../forecast/step-year';
import {validateRetirementCalendar} from './calendar';
import {createRetirementSnapshot,type RetirementSnapshot} from './snapshot';
import {validateRetirementAnalysis} from './validation';
import type {ValidatedRetirementAnalysis} from './definition';
import {settleRetirementYear} from './settle-year';
import type {WithdrawalStrategyId} from './distributions';
import {compareRetirementObjectives,retirementStrategyIds} from './strategies';
import {retirementYearMoneyFields,type RetirementCandidateSummary,type RetirementComparison,type RetirementPath,type RetirementYear} from './results';
import {combineAvailableCents} from '../tax/modified-income';
import {CalculationRangeError} from '../money';
import {resolveRetirementAssumptions} from './assumptions';
const av=<T>(value:T):Available<T>=>({status:'available',value});
const unique=<T>(values:readonly T[]):T[]=>[...new Map(values.map(v=>[JSON.stringify(v),v])).values()];
const unavailable=(issues:readonly Issue[]):Available<never>=>({status:'needs-data',issues});
function sum(values:readonly Available<Cents>[]):Available<Cents>{try{return combineAvailableCents(values);}catch(error){if(!(error instanceof CalculationRangeError))throw error;return {status:'unsupported-case',issues:[{code:'monetary-overflow',field:'retirementObjective',severity:'warning',explanation:'The full-path total exceeds the supported monetary range.',resolution:'Inspect the available annual values.'}]};}}
export interface RetirementAnalysisContext {readonly source:ValidatedPlan;readonly rules:RuleSet;readonly definition:ValidatedRetirementAnalysis;readonly sourceFingerprint:string;readonly ruleFingerprint:string;readonly definitionFingerprint:string;readonly candidateYears:readonly number[];readonly workingCheckpoints:readonly ForecastCheckpoint[];readonly forecast:ForecastContext}
export function prepareRetirementAnalysis(source:ValidatedPlan,rules:RuleSet,definition:ValidatedRetirementAnalysis):Available<RetirementAnalysisContext>{
 const checked=validateRetirementAnalysis(definition,source);if(!checked.ok)return unavailable(checked.issues);
 const candidateYears=Array.from({length:source.horizonYears},(_,i)=>source.startYear+i).filter(y=>y<=2100);
 if(!candidateYears.length)return unavailable([{code:'no-retirement-candidates',field:'startYear',severity:'warning',explanation:'The working forecast has no candidate retirement years through 2100.',resolution:'Choose a working forecast that overlaps the retirement calendar.'}]);
 const forecast=createForecastContext(source,rules),workingCheckpoints=projectWithCheckpoints(source,rules).checkpoints;
 return av({source,rules,definition:checked.definition,sourceFingerprint:forecast.sourceBinding,ruleFingerprint:forecast.ruleBinding,definitionFingerprint:JSON.stringify(checked.definition),candidateYears,workingCheckpoints,forecast});
}
/** Full detail is retained only for the selected policy/candidate, never for comparison trials. */
export function calculateRetirementPath(snapshot:RetirementSnapshot,strategy:WithdrawalStrategyId):RetirementPath{return runPath(snapshot,strategy,true);}
function runPath(snapshot:RetirementSnapshot,strategy:WithdrawalStrategyId,detail:boolean):RetirementPath{
 if(!retirementStrategyIds.includes(strategy))throw new RangeError('Unknown retirement strategy.');
 let closing=snapshot.opening,completion:RetirementPath['completion']='complete',first:RetirementYear|undefined,finalYear:RetirementYear|undefined,transition:RetirementPath['transition'];const years:RetirementYear[]=[],income:Available<Cents>[]=[],additional:Available<Cents>[]=[],issues:Issue[]=[],provenance:RuleProvenance[]=[];
 while(closing.year<=snapshot.endYear){const result=settleRetirementYear(snapshot,closing,strategy),year=result.year;closing=result.closing;first??=compactYear(year);finalYear=year;transition??=result.transition;
  if(detail)years.push(year);income.push(year.afterTaxIncomeCents);const tax=year.tax.complete.tax;additional.push(tax.status==='available'?av((tax.value.federalAdditionalTaxCents??0)+(tax.value.californiaAdditionalTaxCents??0)):tax);
  if(year.fundingStatus==='unavailable'||year.afterTaxIncomeCents.status!=='available'||year.netWorthCents.status!=='available')completion='unavailable';else if(year.fundingStatus==='conditional-on-gap'&&completion==='complete')completion='conditional';issues.push(...year.issues);provenance.push(...year.provenance);
 }
 const totalAfterTaxIncomeCents=sum(income),endingNetWorthCents=finalYear!.netWorthCents,additionalDistributionTaxCents=sum(additional);
 if([totalAfterTaxIncomeCents,endingNetWorthCents,additionalDistributionTaxCents].some(v=>v.status!=='available'))completion='unavailable';
 return {retirementYear:snapshot.retirementYear,strategyId:strategy,years:detail?years:[first!],months:detail?years.flatMap(y=>y.months):[],openingAllocation:first!.openingAllocation,...(transition?{transition}:{}),closing,completion,totalAfterTaxIncomeCents,endingNetWorthCents,additionalDistributionTaxCents,issues:unique(issues),provenance:unique(provenance)};
}
function compactYear(year:RetirementYear):RetirementYear {const {accountMonths:_,...distributions}=year.distributions;return {...year,months:[],distributions};}
function snapshotFor(context:RetirementAnalysisContext,year:number,definition=context.definition):Available<RetirementSnapshot>{
 if(!context.candidateYears.includes(year))throw new RangeError('Year is not a working-forecast retirement candidate.');const calendar=validateRetirementCalendar(context.source,year);if(calendar.status!=='available')return calendar;
 return createRetirementSnapshot(context.forecast,context.workingCheckpoints.find(c=>c.year===year)!,definition,calendar.value);
}
function unavailablePath(context:RetirementAnalysisContext,year:number,strategy:WithdrawalStrategyId,issues:readonly Issue[]):RetirementPath{
 const missing=unavailable(issues),closing=context.workingCheckpoints.find(c=>c.year===year)!,coverage={completeForModeledScope:false,completeHouseholdLiability:false,issues},complete={tax:missing,candidates:[],closingTaxState:closing.taxState,coverage},allocation={year,properties:[],accounts:[],stockCents:missing,cashCents:missing,restrictedCashCents:closing.lastEarmarked,assetCents:missing,debtCents:missing,netWorthCents:missing};
 const firstYear={...Object.fromEntries(retirementYearMoneyFields.map(k=>[k,missing])),year,strategy,funding:{status:'unavailable',grossCents:missing,shortfallCents:missing,evaluations:0,oneCentLowerVerified:false,issues},months:[],tax:{recurringCents:missing,mandatoryExcessCents:missing,transitionCents:missing,totalCents:missing,closingTaxState:closing.taxState,provenance:missing,complete,evaluations:{recurring:complete,mandatoryExcess:complete,complete}},distributions:{acceptedSchedule:{year,legs:[]},closingAccounts:[],closingTaxState:closing.taxState,taxFacts:[],issues,assumptions:[]},fundingStatus:'unavailable',openingAllocation:allocation,coverage,provenance:[resolveRetirementAssumptions(context.source,context.definition).provenance],assumptions:[],issues} as unknown as RetirementYear;
 return {retirementYear:year,strategyId:strategy,years:Array.from({length:2101-year},(_,i)=>({...firstYear,year:year+i,openingAllocation:{...allocation,year:year+i},distributions:{...firstYear.distributions,acceptedSchedule:{year:year+i,legs:[]}}})),months:[],openingAllocation:allocation,closing,completion:'unavailable',totalAfterTaxIncomeCents:missing,endingNetWorthCents:missing,additionalDistributionTaxCents:missing,issues,provenance:firstYear.provenance};
}
function select(context:RetirementAnalysisContext,year:number,definition=context.definition):RetirementPath{
 const snapshot=snapshotFor(context,year,definition);if(snapshot.status!=='available')return unavailablePath(context,year,'annual-tax-aware',snapshot.issues);
 let selected:RetirementPath|undefined;for(const strategy of retirementStrategyIds){const path=runPath(snapshot.value,strategy,false);if(!selected||compareRetirementObjectives(path,selected)<0)selected=path;}return selected!;
}
export function calculateRetirementCandidate(context:RetirementAnalysisContext,retirementYear:number):RetirementCandidateSummary{
 const {stockGrowthBps:_,...projected}=context.definition,selected=select(context,retirementYear),baseline=context.definition.mode==='projected'?selected:select(context,retirementYear,{...projected,mode:'projected',existingProperties:[],newProperties:[],commitments:[]}),firstYear=selected.years[0]!;
 return {retirementYear,strategyId:selected.strategyId,firstYear,totalAfterTaxIncomeCents:selected.totalAfterTaxIncomeCents,endingNetWorthCents:selected.endingNetWorthCents,additionalDistributionTaxCents:selected.additionalDistributionTaxCents,completion:selected.completion,fundingStatus:selected.completion==='unavailable'?'unavailable':selected.completion==='conditional'?'conditional-on-gap':'funded',ranked:selected.completion==='complete',issues:selected.issues,provenance:selected.provenance,projectedComparison:{firstYear:baseline.years[0]!,strategyId:baseline.strategyId,completion:baseline.completion,issues:baseline.issues}};
}
export function calculateRetirementDetails(context:RetirementAnalysisContext,retirementYear:number,strategy:WithdrawalStrategyId):RetirementPath{const snapshot=snapshotFor(context,retirementYear);return snapshot.status==='available'?calculateRetirementPath(snapshot.value,strategy):unavailablePath(context,retirementYear,strategy,snapshot.issues);}
export function calculateRetirementComparison(context:RetirementAnalysisContext):RetirementComparison{return {planId:context.source.id,inputRevision:context.source.revision,definitionFingerprint:context.definitionFingerprint,candidates:context.candidateYears.map(year=>calculateRetirementCandidate(context,year))};}
