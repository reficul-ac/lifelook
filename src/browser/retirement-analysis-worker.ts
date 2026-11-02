import {prepareRetirementAnalysis,calculateRetirementCandidate,calculateRetirementDetails,calculateProjection,type ValidatedPlan,type RuleSet,type ValidatedRetirementAnalysis,type RetirementCandidateSummary,type RetirementComparison,type RetirementPath,type ProjectionResult,type Issue,type WithdrawalStrategyId} from '../engine';
import type {RetirementRequestOwner} from './retirement-analysis';
interface RetirementWorkerInputs {readonly owner:RetirementRequestOwner;readonly plan:ValidatedPlan;readonly ruleSet:RuleSet;readonly definition:ValidatedRetirementAnalysis}
export type RetirementWorkerRequest=(RetirementWorkerInputs&Readonly<{kind:'comparison';needsProjection:boolean}>)|(RetirementWorkerInputs&Readonly<{kind:'detail';retirementYear:number;strategyId?:WithdrawalStrategyId}>);
export type RetirementWorkerReply=Readonly<{owner:RetirementRequestOwner}>&(
 Readonly<{kind:'progress';completed:number;total:number}>|Readonly<{kind:'candidate';candidate:RetirementCandidateSummary;completed:number;total:number}>|Readonly<{kind:'complete';comparison:RetirementComparison;projection?:ProjectionResult;issues:readonly Issue[]}>|Readonly<{kind:'detail';path:RetirementPath;candidate?:RetirementCandidateSummary}>|Readonly<{kind:'failed';issues:readonly Issue[]}>);
export function runRetirementAnalysisRequest(request:RetirementWorkerRequest,post:(reply:RetirementWorkerReply)=>void):void {
 const {owner,plan,ruleSet,definition}=request;
 try{
  if(owner.candidateBinding!==JSON.stringify(plan)||owner.ruleBinding!==JSON.stringify(ruleSet)||owner.definitionFingerprint!==JSON.stringify(definition)||owner.inputRevision!==plan.revision||owner.ruleVersion!==ruleSet.version)throw Error('Request binding mismatch.');
  const context=prepareRetirementAnalysis(plan,ruleSet,definition);
  if(context.status!=='available'){
   if(request.kind==='comparison'&&plan.startYear>2100){post({kind:'complete',owner,comparison:{planId:plan.id,inputRevision:plan.revision,definitionFingerprint:owner.definitionFingerprint,candidates:[]},...(request.needsProjection?{projection:calculateProjection(plan,ruleSet)}:{}),issues:context.issues});return;}
   post({kind:'failed',owner,issues:context.issues});return;
  }
  if(request.kind==='detail'){const candidate=request.strategyId?undefined:calculateRetirementCandidate(context.value,request.retirementYear),strategy=request.strategyId??candidate!.strategyId;post({kind:'detail',owner,path:calculateRetirementDetails(context.value,request.retirementYear,strategy),...(candidate?{candidate}:{})});return;}
  const candidates:RetirementCandidateSummary[]=[],total=context.value.candidateYears.length;post({kind:'progress',owner,completed:0,total});
  for(const year of context.value.candidateYears){const candidate=calculateRetirementCandidate(context.value,year);candidates.push(candidate);post({kind:'candidate',owner,candidate,completed:candidates.length,total});post({kind:'progress',owner,completed:candidates.length,total});}
  post({kind:'complete',owner,comparison:{planId:plan.id,inputRevision:plan.revision,definitionFingerprint:owner.definitionFingerprint,candidates},...(request.needsProjection?{projection:calculateProjection(plan,ruleSet)}:{}),issues:[]});
 }catch{post({kind:'failed',owner,issues:[{code:'retirement-calculation-failed',field:'retirementAnalysis',severity:'error',explanation:'The retirement calculation stopped before completion.',resolution:'Review the inputs and retry the calculation.'}]});}
}
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<RetirementWorkerRequest>)=>void)|null;postMessage?:(reply:RetirementWorkerReply)=>void};
if(typeof document==='undefined'&&typeof scope.postMessage==='function')scope.onmessage=event=>runRetirementAnalysisRequest(event.data,reply=>scope.postMessage!(reply));
