import type {AduBuildComparison,Available,Issue,RuleSet,ValidatedPlan} from '../engine';
import type {PreviewOwner} from './scenario-session';
import {prepareAduComparison,type WorkspaceController} from './state';
import {calculateAduComparisonWorker,type AduComparisonWorkerReply,type AduComparisonWorkerRequest} from './adu-comparison-worker';
export interface AduComparisonBindingOwner extends PreviewOwner {readonly workspaceGeneration:number}
export interface AduComparisonRequestOwner extends AduComparisonBindingOwner {readonly projectId:string;readonly inputRevision:number;readonly ruleVersion:string;readonly selectionGeneration:number;readonly requestGeneration:number}
export interface AduComparisonViewState {readonly status:'inactive'|'pending'|'calculated'|'failed';readonly comparison?:AduBuildComparison;readonly issues:readonly Issue[]}
export interface AduComparisonScheduler {select(projectId:string|undefined):void;request():void;invalidate():void;dispose():void}
interface Cached {plan:ValidatedPlan;rules:RuleSet;version:string;projectId:string;comparison:AduBuildComparison}
const caches=new WeakMap<WorkspaceController,Cached[]>();
const failure=(projectId:string):AduComparisonViewState=>({status:'failed',issues:[{code:'adu-comparison-failed',recordId:projectId,field:'aduComparison',severity:'error',explanation:'The applied ADU comparison could not be calculated.',resolution:'Request again after resolving the affected inputs.'}]});
const ownerKeys:readonly (keyof AduComparisonRequestOwner)[]=['workspaceGeneration','scenarioId','sessionGeneration','activationGeneration','projectId','inputRevision','ruleVersion','selectionGeneration','requestGeneration'];
/** Authority is live binding + immutable applied plan + selection + calculation generation. */
export function createAduComparisonScheduler(controller:WorkspaceController,publish:(state:AduComparisonViewState)=>void,ownership:{owner:AduComparisonBindingOwner;isCurrent:(owner:AduComparisonBindingOwner)=>boolean}):AduComparisonScheduler {
 let selected:string|undefined,selectionGeneration=0,requestGeneration=0,frame:number|undefined,worker:Worker|undefined,disposed=false;
 let previous=controller.getState().savedPlan;
 const live=()=>!disposed&&ownership.isCurrent(ownership.owner);
 const cancel=()=>{requestGeneration++;if(frame!==undefined){cancelAnimationFrame(frame);frame=undefined;}worker?.terminate();worker=undefined;};
 const invalidate=()=>cancel();
 const request=()=>{
  if(!live()||!selected)return;cancel();const projectId=selected,generation=requestGeneration,selection=selectionGeneration;
  publish({status:'pending',issues:[]});
  frame=requestAnimationFrame(()=>{
   frame=undefined;if(!live()||generation!==requestGeneration)return;
   const prepared=prepareAduComparison(controller,projectId);
   if(prepared.status!=='ready'){publish({status:'failed',issues:prepared.issues});return;}
   const token:AduComparisonRequestOwner={...ownership.owner,projectId,inputRevision:prepared.inputRevision,ruleVersion:prepared.ruleSet.version,selectionGeneration:selection,requestGeneration:generation};
   const current=()=>live()&&generation===requestGeneration&&selection===selectionGeneration&&selected===projectId&&controller.getState().savedPlan===prepared.plan&&prepared.ruleSet.version===token.ruleVersion&&controller.getState().savedPlan.properties.some(p=>p.aduProject?.id===projectId);
   const accept=(result:Available<AduBuildComparison>)=>{
    if(!current())return;
    if(result.status==='available'){
     if(result.value.projectId!==projectId||result.value.build.inputRevision!==prepared.inputRevision||result.value.build.planId!==prepared.plan.id)return;
     const cache=(caches.get(controller)??[]).filter(c=>c.plan===prepared.plan&&c.rules===prepared.ruleSet&&c.version===token.ruleVersion&&c.projectId!==projectId);
     cache.push({plan:prepared.plan,rules:prepared.ruleSet,version:token.ruleVersion,projectId,comparison:result.value});caches.set(controller,cache);
     publish({status:'calculated',comparison:result.value,issues:result.value.issues});
    }else publish({status:'failed',issues:result.issues});
   };
   const cached=caches.get(controller)?.find(c=>c.plan===prepared.plan&&c.rules===prepared.ruleSet&&c.version===token.ruleVersion&&c.projectId===projectId);
   if(cached){accept({status:'available',value:cached.comparison});return;}
   const message:AduComparisonWorkerRequest={owner:token,plan:prepared.plan,ruleSet:prepared.ruleSet};
   if(typeof Worker==='undefined'){accept(calculateAduComparisonWorker(message).result);return;}
   let running:Worker|undefined,settled=false;
   const failed=()=>{if(settled)return;settled=true;running?.terminate();if(worker===running)worker=undefined;if(current())publish(failure(projectId));};
   try{
    running=new Worker(new URL('./adu-comparison-worker.ts',import.meta.url),{type:'module'});worker=running;
    running.onerror=failed;running.onmessageerror=failed;
    running.onmessage=(event:MessageEvent<AduComparisonWorkerReply>)=>{
     if(settled||!event.data.owner||ownerKeys.some(key=>event.data.owner[key]!==token[key])||!current())return;
     settled=true;running?.terminate();if(worker===running)worker=undefined;accept(event.data.result);
    };running.postMessage(message);
   }catch{failed();}
  });
 };
 const select=(projectId:string|undefined)=>{if(!live())return;selectionGeneration++;selected=projectId;cancel();if(selected)request();else publish({status:'inactive',issues:[]});};
 const unsubscribe=controller.subscribe(()=>{const next=controller.getState().savedPlan;if(next!==previous){previous=next;cancel();if(selected&&!next.properties.some(p=>p.aduProject?.id===selected))select(undefined);else request();}});
 return{select,request,invalidate,dispose(){if(disposed)return;disposed=true;cancel();unsubscribe();}};
}
