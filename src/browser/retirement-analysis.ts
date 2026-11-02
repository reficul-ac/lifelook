import type {Issue,RetirementComparison,RetirementCandidateSummary,RetirementPath,ValidatedPlan,RuleSet,ProjectionResult} from '../engine';
import type {PreviewOwner,ScenarioEditorSession} from './scenario-session';
import type {ScenarioManager} from './scenario-manager';
import type {WorkspaceController} from './state';
import {prepareRetirementWorkspace,completeRetirementEdit,type PreparedRetirementWorkspace,type RetirementReceipt} from './retirement-state';
import type {RetirementWorkerRequest,RetirementWorkerReply} from './retirement-analysis-worker';
export interface RetirementBindingOwner extends PreviewOwner {readonly workspaceGeneration:number}
export interface RetirementBindingOwnership {readonly owner:RetirementBindingOwner;isCurrent(owner:RetirementBindingOwner):boolean}
export interface RetirementRequestOwner extends RetirementBindingOwner {readonly sourceBinding:string;readonly candidateBinding:string;readonly inputRevision:number;readonly definitionFingerprint:string;readonly definitionGeneration:number;readonly ruleVersion:string;readonly ruleBinding:string;readonly requestGeneration:number;readonly detailGeneration:number}
export interface RetirementOwnedComparison {readonly owner:RetirementRequestOwner;readonly scope:'applied'|'draft';readonly comparison:RetirementComparison}
export interface RetirementOwnedDetail {readonly owner:RetirementRequestOwner;readonly path:RetirementPath}
export interface RetirementAnalysisViewState {readonly status:'inactive'|'pending'|'calculated'|'invalid'|'stale'|'failed';readonly owner?:RetirementRequestOwner;readonly scope?:'applied'|'draft';readonly comparison?:RetirementComparison;readonly retained?:RetirementOwnedComparison;readonly candidates:readonly RetirementCandidateSummary[];readonly progress?:Readonly<{completed:number;total:number}>;readonly detailStatus:'inactive'|'pending'|'calculated'|'failed';readonly detail?:RetirementOwnedDetail;readonly receipt?:RetirementReceipt;readonly issues:readonly Issue[]}
export interface RetirementAnalysisScheduler {request(scope?:'applied'|'draft'):void;selectYear(year:number):void;invalidate():void;dispose():void}
/** Revocation survives leaving and returning to the same retained session. */
export function captureRetirementBindingOwnership(manager:ScenarioManager,session:ScenarioEditorSession,activationGeneration:number):RetirementBindingOwnership&{dispose():void}{
 const owner=Object.freeze({scenarioId:session.scenarioId,sessionGeneration:session.generation,activationGeneration,workspaceGeneration:manager.getState().workspaceGeneration});let revoked=false;
 const active=()=>manager.getActiveSession()===session&&manager.getState().workspaceGeneration===owner.workspaceGeneration&&manager.isCurrentTarget({scenarioId:owner.scenarioId,generation:owner.sessionGeneration,workspaceGeneration:owner.workspaceGeneration});
 const unsubscribe=manager.subscribe(()=>{if(!active())revoked=true;});return {owner,isCurrent:current=>!revoked&&current===owner&&active(),dispose(){revoked=true;unsubscribe();}};
}
interface Cache {readonly base:ValidatedPlan;readonly rules:RuleSet;readonly key:string;comparison?:RetirementComparison;projection?:ProjectionResult;paths:Map<number,RetirementPath>}
const caches=new WeakMap<WorkspaceController,Cache>();
const ownerKeys:readonly (keyof RetirementRequestOwner)[]=['workspaceGeneration','scenarioId','sessionGeneration','activationGeneration','sourceBinding','candidateBinding','inputRevision','definitionFingerprint','definitionGeneration','ruleVersion','ruleBinding','requestGeneration','detailGeneration'];
const problem=(code:string,text:string):readonly Issue[]=>[{code,field:'retirementAnalysis',severity:'error',explanation:text,resolution:'Review the current inputs and retry.'}];
export function createRetirementAnalysisScheduler(controller:WorkspaceController,publish:(state:RetirementAnalysisViewState)=>void,ownership:RetirementBindingOwnership):RetirementAnalysisScheduler {
 let state:RetirementAnalysisViewState={status:'inactive',candidates:[],detailStatus:'inactive',issues:[]},scope:'applied'|'draft'='applied',disposed=false,requestGeneration=0,detailGeneration=0,comparisonWorker:Worker|undefined,detailWorker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,selected:number|undefined;
 let previous=controller.getState(),active:Extract<PreparedRetirementWorkspace,{status:'ready'}>|undefined,base:ValidatedPlan|undefined,activeOwner:RetirementRequestOwner|undefined,cache:Cache|undefined;
 let candidates=new Map<number,RetirementCandidateSummary>();
 const live=()=>!disposed&&ownership.isCurrent(ownership.owner),emit=(value:RetirementAnalysisViewState)=>{state=value;if(live())publish(value);};
 const retained=():RetirementOwnedComparison|undefined=>state.comparison&&state.owner?{owner:state.owner,scope:state.scope??scope,comparison:state.comparison}:state.retained;
 const cancelDetail=()=>{detailGeneration++;if(timer!==undefined){clearTimeout(timer);timer=undefined;}detailWorker?.terminate();detailWorker=undefined;};
 const cancel=()=>{requestGeneration++;comparisonWorker?.terminate();comparisonWorker=undefined;cancelDetail();};
 const current=(owner:RetirementRequestOwner,prepared:Extract<PreparedRetirementWorkspace,{status:'ready'}>,source:ValidatedPlan)=>live()&&requestGeneration===owner.requestGeneration&&controller.getState().savedPlan===source&&JSON.stringify(source)===owner.sourceBinding&&controller.getRetirementDraft().generation===owner.definitionGeneration&&JSON.stringify(prepared.plan)===owner.candidateBinding&&prepared.ruleSet.version===owner.ruleVersion&&JSON.stringify(prepared.ruleSet)===owner.ruleBinding;
 const same=(a:RetirementRequestOwner,b:RetirementRequestOwner)=>!!a&&ownerKeys.every(key=>a[key]===b[key]);
 const empty=(status:RetirementAnalysisViewState['status'],issues:readonly Issue[]=[])=>{const old=retained();emit({status,...(old?{retained:old}:{}),candidates:[],detailStatus:'inactive',issues});};
 const validComparison=(comparison:RetirementComparison,prepared:Extract<PreparedRetirementWorkspace,{status:'ready'}>)=>comparison.planId===prepared.plan.id&&comparison.inputRevision===prepared.plan.revision&&comparison.definitionFingerprint===prepared.definitionFingerprint&&JSON.stringify(comparison.candidates.map(c=>c.retirementYear))===JSON.stringify(Array.from({length:prepared.plan.horizonYears},(_,i)=>prepared.plan.startYear+i).filter(y=>y<=2100))&&comparison.candidates.every(c=>c.firstYear.year===c.retirementYear&&c.firstYear.strategy===c.strategyId);
 const acceptComparison=(comparison:RetirementComparison,projection:ProjectionResult|undefined,issues:readonly Issue[],owner:RetirementRequestOwner,prepared:Extract<PreparedRetirementWorkspace,{status:'ready'}>,source:ValidatedPlan):boolean=>{
  if(!current(owner,prepared,source)||!validComparison(comparison,prepared))return false;
  if(prepared.edit&&(!projection||projection.planId!==prepared.plan.id||projection.inputRevision!==prepared.plan.revision))return false;
  const receipt=prepared.edit?completeRetirementEdit(controller,prepared.edit,{projection:projection!,comparison}):undefined;if(prepared.edit&&!receipt)return false;
  cache!.comparison=comparison;if(projection)cache!.projection=projection;
  emit({...state,status:'calculated',owner,scope:prepared.edit?'draft':'applied',comparison,candidates:comparison.candidates,progress:{completed:comparison.candidates.length,total:comparison.candidates.length},...(receipt?{receipt}:{}),issues});
  if(selected!==undefined&&!detailWorker&&timer===undefined&&!state.detail)selectYear(selected);return true;
 };
 const selectYear=(year:number)=>{
  if(!live()||!Number.isInteger(year)||!active||!activeOwner||!base||year<active.plan.startYear||year>=active.plan.startYear+active.plan.horizonYears||year>2100)return;
  selected=year;cancelDetail();const prepared=active,source=base,owner={...activeOwner,detailGeneration},cached=cache?.paths.get(year);
  if(cached&&current(owner,prepared,source)){cache!.paths.delete(year);cache!.paths.set(year,cached);emit({...state,detailStatus:'calculated',detail:{owner,path:cached}});return;}
  const {detail:_,...withoutDetail}=state;emit({...withoutDetail,detailStatus:'pending'});
  timer=setTimeout(()=>{
   timer=undefined;if(!current(owner,prepared,source)||owner.detailGeneration!==detailGeneration||selected!==year)return;
   if(typeof Worker==='undefined'){emit({...state,detailStatus:'failed',issues:problem('retirement-calculation-unavailable','This browser cannot start the retirement calculation worker.')});return;}
   const strategy=state.comparison?.candidates.find(c=>c.retirementYear===year)?.strategyId??state.candidates.find(c=>c.retirementYear===year)?.strategyId;
   const message:RetirementWorkerRequest={kind:'detail',owner,plan:prepared.plan,definition:prepared.definition,ruleSet:prepared.ruleSet,retirementYear:year,...(strategy?{strategyId:strategy}:{})};let running:Worker|undefined,settled=false;
   const matches=()=>current(owner,prepared,source)&&owner.detailGeneration===detailGeneration&&selected===year;
   const finish=()=>{settled=true;running?.terminate();if(detailWorker===running)detailWorker=undefined;};
   const failed=(issues=problem('retirement-detail-failed','The selected retirement path could not be calculated.'))=>{if(settled)return;finish();if(matches())emit({...state,detailStatus:'failed',issues});};
   try{running=new Worker(new URL('./retirement-analysis-worker.ts',import.meta.url),{type:'module'});detailWorker=running;running.onerror=()=>failed();running.onmessageerror=()=>failed();running.onmessage=(event:MessageEvent<RetirementWorkerReply>)=>{
    const reply=event.data;if(settled||!same(reply.owner,owner)||!matches())return;if(reply.kind==='failed'){failed(reply.issues);return;}if(reply.kind!=='detail'||reply.path.retirementYear!==year||reply.path.years[0]?.year!==year||strategy&&reply.path.strategyId!==strategy)return;
    finish();if(reply.candidate&&state.status==='pending'&&reply.candidate.retirementYear===year&&reply.candidate.strategyId===reply.path.strategyId){candidates.set(year,reply.candidate);state={...state,candidates:[...candidates.values()].sort((a,b)=>a.retirementYear-b.retirementYear),progress:{completed:candidates.size,total:state.progress!.total}};}cache!.paths.delete(year);cache!.paths.set(year,reply.path);while(cache!.paths.size>2)cache!.paths.delete(cache!.paths.keys().next().value!);emit({...state,detailStatus:'calculated',detail:{owner,path:reply.path}});
   };running.postMessage(message);}catch{failed();}
  },150);
 };
 const request=(requested=scope)=>{
  if(!live())return;const old=retained();scope=requested;cancel();candidates=new Map();active=undefined;activeOwner=undefined;base=undefined;cache=undefined;
  const prepared=prepareRetirementWorkspace(controller,scope);if(prepared.status!=='ready'){emit({status:prepared.status,...(old?{retained:old}:{}),candidates:[],detailStatus:'inactive',issues:prepared.issues});return;}
  const source=controller.getState().savedPlan as ValidatedPlan,owner:RetirementRequestOwner={...ownership.owner,sourceBinding:JSON.stringify(source),candidateBinding:JSON.stringify(prepared.plan),inputRevision:prepared.plan.revision,definitionFingerprint:prepared.definitionFingerprint,definitionGeneration:prepared.draftGeneration,ruleVersion:prepared.ruleSet.version,ruleBinding:JSON.stringify(prepared.ruleSet),requestGeneration,detailGeneration};active=prepared;activeOwner=owner;base=source;
  const key=JSON.stringify([owner.candidateBinding,owner.definitionFingerprint,owner.ruleVersion,owner.ruleBinding]),existing=caches.get(controller);cache=existing?.base===source&&existing.rules===prepared.ruleSet&&existing.key===key?existing:{base:source,rules:prepared.ruleSet,key,paths:new Map()};caches.set(controller,cache);
  emit({status:'pending',owner,scope:prepared.edit?'draft':'applied',...(old?{retained:old}:{}),candidates:[],progress:{completed:0,total:Math.max(0,Math.min(prepared.plan.horizonYears,2101-prepared.plan.startYear))},detailStatus:'inactive',issues:[]});
  const applied=controller.getState().retirementResult;if(!prepared.edit&&applied&&validComparison(applied.comparison,prepared)){cache.comparison=applied.comparison;cache.projection=applied.projection;}
  if(cache.comparison&&(!prepared.edit||cache.projection)){acceptComparison(cache.comparison,cache.projection,[],owner,prepared,source);return;}
  if(typeof Worker==='undefined'){empty('failed',problem('retirement-calculation-unavailable','This browser cannot start the retirement calculation worker.'));return;}
  const message:RetirementWorkerRequest={kind:'comparison',owner,plan:prepared.plan,ruleSet:prepared.ruleSet,definition:prepared.definition,needsProjection:!!prepared.edit};let running:Worker|undefined,settled=false;
  const finish=()=>{settled=true;running?.terminate();if(comparisonWorker===running)comparisonWorker=undefined;};
  const failed=(issues=problem('retirement-calculation-failed','The retirement comparison stopped before completion.'))=>{if(settled)return;finish();if(current(owner,prepared,source))empty('failed',issues);};
  try{running=new Worker(new URL('./retirement-analysis-worker.ts',import.meta.url),{type:'module'});comparisonWorker=running;running.onerror=()=>failed();running.onmessageerror=()=>failed();running.onmessage=(event:MessageEvent<RetirementWorkerReply>)=>{
   const reply=event.data;if(settled||!same(reply.owner,owner)||!current(owner,prepared,source))return;
   if(reply.kind==='failed'){failed(reply.issues);return;}
   if(reply.kind==='candidate'){const year=reply.candidate.retirementYear;if(year<prepared.plan.startYear||year>=prepared.plan.startYear+prepared.plan.horizonYears||year>2100||reply.candidate.firstYear.year!==year)return;candidates.set(year,reply.candidate);emit({...state,status:'pending',candidates:[...candidates.values()].sort((a,b)=>a.retirementYear-b.retirementYear),progress:{completed:candidates.size,total:state.progress!.total}});return;}
   if(reply.kind==='progress')return;
   if(reply.kind==='complete'&&acceptComparison(reply.comparison,reply.projection,reply.issues,owner,prepared,source))finish();
  };running.postMessage(message);if(selected!==undefined)selectYear(selected);}catch{failed();}
 };
 const unsubscribe=controller.subscribe(()=>{const next=controller.getState(),changed=next.savedPlan!==previous.savedPlan||next.retirementDraft!==previous.retirementDraft;previous=next;if(changed&&live())request();});
 return {request,selectYear,invalidate(){cancel();active=undefined;activeOwner=undefined;caches.delete(controller);if(live())empty('stale');},dispose(){if(disposed)return;disposed=true;cancel();unsubscribe();}};
}
