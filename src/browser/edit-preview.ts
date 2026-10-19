import type {Issue} from '../engine';
import {applyCalculatedEdit,completePreparedEdit,prepareEdit,type SaveRecordResult,type WorkspaceController} from './state';
import type {EditPreviewCoordinator,EditPreviewOwner,EditPreviewState,EditTarget,PreviewReport} from './edit-types';
import {calculateEditPreview,editCalculationIssues,type EditPreviewWorkerReply,type EditPreviewWorkerRequest} from './edit-preview-worker';
import type {AllocationPreviewSession} from './scenario-session';
export function createEditPreviewCoordinator(controller:WorkspaceController,ownership:{owner:EditPreviewOwner;isCurrent():boolean},options:{quietMs?:number;maxWaitMs?:number;allocationSession?:AllocationPreviewSession}={}):EditPreviewCoordinator {
  const owner=Object.freeze({...ownership.owner}),quietMs=options.quietMs??100,maxWaitMs=options.maxWaitMs??300,listeners=new Set<(state:EditPreviewState)=>void>();
  let state:EditPreviewState={status:'inactive',target:null,current:null,lastValid:null,issues:[]},disposed=false,jobId=0,worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,frame:number|undefined,firstRequest:number|undefined;
  let previous=controller.getState();
  const sameOwner=(reply:EditPreviewOwner)=>reply&&reply.scenarioId===owner.scenarioId&&reply.sessionGeneration===owner.sessionGeneration&&reply.activationGeneration===owner.activationGeneration&&reply.workspaceGeneration===owner.workspaceGeneration;
  const active=()=>!disposed&&ownership.isCurrent();
  const emit=(next:EditPreviewState)=>{
    state=next;
    const cache=options.allocationSession;
    if(state.target?.kind==='allocation'&&cache){
      cache.status=state.status==='stale'?'invalid':state.status;cache.issues=state.issues;
      if(state.lastValid)cache.lastValid={plan:state.lastValid.plan,projection:state.lastValid.projection,...(state.lastValid.basePlan?{basePlan:state.lastValid.basePlan}:{})};
    }
    listeners.forEach(listener=>listener(state));
  };
  const cancel=()=>{jobId++;if(timer!==undefined){clearTimeout(timer);timer=undefined;}if(frame!==undefined){cancelAnimationFrame(frame);frame=undefined;}worker?.terminate();worker=undefined;};
  const stop=()=>{cancel();firstRequest=undefined;};
  const reject=():SaveRecordResult=>{const saved=controller.getState();return {accepted:false,persisted:saved.persisted,persistenceIssues:saved.persistenceIssues,issues:state.issues.length?state.issues:[{code:'stale-edit-preview',field:'plan',severity:'error',explanation:'A current completed preview is required before applying.',resolution:'Review the inputs and wait for the current preview.'}]};};
  const run=()=>{
    frame=undefined;firstRequest=undefined;if(!active()||!state.target)return;
    const target=state.target,prepared=prepareEdit(controller,target),capturedJob=jobId;
    if(prepared.status==='unchanged'){emit({status:'inactive',target,current:null,lastValid:null,issues:[]});return;}
    if(prepared.status!=='ready'){emit({...state,status:prepared.status,current:null,issues:prepared.issues});return;}
    const current=()=>active()&&capturedJob===jobId&&state.target===target;
    const failed=(issues:readonly Issue[]=editCalculationIssues())=>{if(current())emit({...state,status:'failed',current:null,issues});};
    const accept=(reply:EditPreviewWorkerReply)=>{
      if(!current()||!reply||reply.jobId!==capturedJob||reply.token!==prepared.token||!sameOwner(reply.owner)||!reply.result)return;
      if(reply.result.status==='failed'){failed(reply.result.issues);return;}
      if(reply.result.status!=='calculated'||reply.result.projection?.inputRevision!==prepared.plan.revision)return;
      const receipt=completePreparedEdit(controller,prepared,reply.result.projection);
      if(!receipt)return;
      const report:PreviewReport={plan:prepared.plan,projection:receipt.projection,basePlan:prepared.basePlan};
      emit({status:'valid',target,current:receipt,lastValid:report,issues:[]});
    };
    const request:EditPreviewWorkerRequest={jobId:capturedJob,owner,token:prepared.token,plan:prepared.plan,ruleSet:prepared.ruleSet};
    if(typeof Worker==='undefined'){accept(calculateEditPreview(request));return;}
    let running:Worker,settled=false;
    try{
      running=new Worker(new URL('./edit-preview-worker.ts',import.meta.url),{type:'module'});worker=running;
      const finish=()=>{settled=true;running.terminate();if(worker===running)worker=undefined;};
      const failure=()=>{if(settled)return;finish();failed();};
      running.onerror=failure;running.onmessageerror=failure;
      running.onmessage=(event:MessageEvent<EditPreviewWorkerReply>)=>{if(settled||!current())return;const before=state;accept(event.data);if(state!==before)finish();};
      running.postMessage(request);
    }catch{worker?.terminate();worker=undefined;if(!settled){settled=true;failed();}}
  };
  const request=(flush=false)=>{
    if(!active()||!state.target)return;
    cancel();const now=Date.now();firstRequest??=now;
    const base=controller.getState().savedPlan,lastValid=state.lastValid&&state.lastValid.basePlan!==base?{...state.lastValid,basePlan:null}:state.lastValid;
    emit({...state,status:'pending',current:null,lastValid,issues:[]});
    const scheduledJob=jobId;const launch=()=>{timer=undefined;frame=requestAnimationFrame(()=>{if(scheduledJob===jobId)run();});};
    if(flush)launch();else timer=setTimeout(launch,Math.max(0,Math.min(quietMs,maxWaitMs-(now-firstRequest))));
  };
  const select=(target:EditTarget|null)=>{
    if(disposed)return;stop();let lastValid:PreviewReport|null=null;
    if(target?.kind==='allocation'&&options.allocationSession?.lastValid){const retained=options.allocationSession.lastValid;lastValid={...retained,basePlan:retained.basePlan===controller.getState().savedPlan?retained.basePlan:null};}
    emit({status:'inactive',target:target?{...target}:null,current:null,lastValid,issues:[]});
    if(target){const prepared=prepareEdit(controller,target);if(prepared.status==='unchanged')return;request();}
  };
  const unsubscribe=controller.subscribe(operation=>{
    const next=controller.getState(),before=previous;previous=next;
    if(disposed||!state.target)return;
    if(operation?.kind==='restore'){select(null);return;}
    const target=state.target,changed=next.savedPlan!==before.savedPlan||(target.kind==='allocation'?next.allocationDraft!==before.allocationDraft:next.drafts[target.recordId]!==before.drafts[target.recordId]);
    if(changed)request();
  });
  return {getState:()=>state,subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},select,request,
    apply(){if(!active()||!state.current)return reject();const result=applyCalculatedEdit(controller,state.current);if(result.accepted){stop();emit({status:'inactive',target:state.target,current:null,lastValid:null,issues:[]});}else request();return result;},
    discard(){if(!active()||!state.target)return;const target=state.target;stop();if(target.kind==='allocation')controller.discardAllocationDraft();else controller.discardDraft(target.recordId);stop();emit({status:'inactive',target,current:null,lastValid:null,issues:[]});},
    dispose(){if(disposed)return;disposed=true;stop();unsubscribe();state={status:'inactive',target:null,current:null,lastValid:null,issues:[]};listeners.clear();},
  };
}
