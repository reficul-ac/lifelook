import type {PreviewOwner} from './scenario-session';
import { calculateProjection,type ValidatedPlan,type RuleSet } from '../engine';
import type { CashFlowAllocationPreview } from './state';

export interface AllocationPreviewWorkerRequest {readonly owner?:PreviewOwner;readonly generation:number;readonly plan:ValidatedPlan;readonly ruleSet:RuleSet;readonly inputRevision:number}
export interface AllocationPreviewWorkerReply {readonly owner?:PreviewOwner;readonly generation:number;readonly preview:CashFlowAllocationPreview}

/** Pure worker calculation: candidate validation and rule selection happen in the owning workspace. */
export function calculateAllocationPreview(request:AllocationPreviewWorkerRequest):AllocationPreviewWorkerReply {
  let preview:CashFlowAllocationPreview;
  try {preview={status:'calculated',projection:calculateProjection(request.plan,request.ruleSet),inputRevision:request.inputRevision};}
  catch {preview={status:'failed',inputRevision:request.inputRevision,issues:[{code:'calculation-failed',field:'cashFlowAllocation',severity:'error',explanation:'These allocation inputs could not be calculated. The saved plan and projection have been retained.',resolution:'Correct the draft inputs and request a new preview or Apply again.'}]};}
  return {generation:request.generation,preview,...(request.owner?{owner:request.owner}:{})};
}

const scope=globalThis as unknown as {onmessage:((event:MessageEvent<AllocationPreviewWorkerRequest>)=>void)|null;postMessage?:(reply:AllocationPreviewWorkerReply)=>void};
if(typeof document==='undefined'&&typeof scope.postMessage==='function')scope.onmessage=event=>scope.postMessage!(calculateAllocationPreview(event.data));
