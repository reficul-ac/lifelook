import type {PreviewOwner} from './scenario-session';
export interface AllocationPreviewOwnership {owner:PreviewOwner;isCurrent(owner:PreviewOwner):boolean}
import { allocationCalculationFailure,allocationPreviewEpoch,prepareAllocationPreview,type WorkspaceController,type CashFlowAllocationPreview } from './state';
import type { AllocationPreviewWorkerReply,AllocationPreviewWorkerRequest } from './allocation-preview-worker';
export interface AllocationPreviewScheduler {request():void;invalidate():void;dispose():void}

/** At most one coalesced frame and one calculation; new inputs terminate obsolete work. */
export function createAllocationPreviewScheduler(controller:WorkspaceController,publish:(preview:CashFlowAllocationPreview)=>void,ownership?:AllocationPreviewOwnership):AllocationPreviewScheduler {
  let generation=0,frame:number|undefined,worker:Worker|undefined,disposed=false,requested=false;
  let state=controller.getState(),epoch=allocationPreviewEpoch(controller);
  const cancel=()=>{generation++;if(frame!==undefined){cancelAnimationFrame(frame);frame=undefined;}worker?.terminate();worker=undefined;};
  const invalidate=()=>{requested=false;cancel();};
  const request=()=>{
    if(disposed||ownership&&!ownership.isCurrent(ownership.owner))return;
    requested=true;cancel();const token=generation;
    frame=requestAnimationFrame(()=>{
      frame=undefined;if(disposed||token!==generation)return;
      const savedPlan=controller.getState().savedPlan,draft=controller.getState().allocationDraft,capturedEpoch=allocationPreviewEpoch(controller);
      const current=()=>!disposed&&(!ownership||ownership.isCurrent(ownership.owner))&&token===generation&&savedPlan===controller.getState().savedPlan&&draft===controller.getState().allocationDraft&&capturedEpoch===allocationPreviewEpoch(controller);
      const accept=(preview:CashFlowAllocationPreview)=>{if(current())publish(preview);};
      const prepared=prepareAllocationPreview(controller);
      if(prepared.status!=='ready'){accept(prepared);return;}
      if(prepared.plan===savedPlan){accept({status:'calculated',projection:controller.getState().projection,inputRevision:savedPlan.revision});return;}
      // Worker absence is the only synchronous fallback. A broken supported worker reports failure.
      if(typeof Worker==='undefined'){accept(controller.previewAllocation());return;}
      let running:Worker,settled=false;
      try {
        running=new Worker(new URL('./allocation-preview-worker.ts',import.meta.url),{type:'module'});worker=running;
        const stop=()=>{running.terminate();if(worker===running)worker=undefined;};
        const settle=(preview:CashFlowAllocationPreview)=>{if(settled)return;settled=true;stop();accept(preview);};
        const failed=()=>settle(allocationCalculationFailure(prepared.inputRevision));
        running.onerror=failed;running.onmessageerror=failed;
        running.onmessage=(event:MessageEvent<AllocationPreviewWorkerReply>)=>{
          const reply=event.data;
          if(ownership&&(!reply.owner||reply.owner.scenarioId!==ownership.owner.scenarioId||reply.owner.sessionGeneration!==ownership.owner.sessionGeneration||reply.owner.activationGeneration!==ownership.owner.activationGeneration))return;
          if(reply.generation!==token||reply.preview.inputRevision!==prepared.inputRevision)return;
          settle(reply.preview);
        };
        const message:AllocationPreviewWorkerRequest={generation:token,plan:prepared.plan,ruleSet:prepared.ruleSet,inputRevision:prepared.inputRevision,...(ownership?{owner:ownership.owner}:{})};
        running.postMessage(message);
      } catch {worker?.terminate();worker=undefined;if(!settled){settled=true;accept(allocationCalculationFailure(prepared.inputRevision));}}
    });
  };
  const unsubscribe=controller.subscribe(()=>{
    const next=controller.getState(),nextEpoch=allocationPreviewEpoch(controller);
    if(nextEpoch!==epoch){invalidate();}
    else if(requested&&(next.savedPlan!==state.savedPlan||next.allocationDraft!==state.allocationDraft))request();
    state=next;epoch=nextEpoch;
  });
  return {request,invalidate,dispose(){if(disposed)return;disposed=true;invalidate();unsubscribe();}};
}
