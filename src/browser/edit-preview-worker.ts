import {calculateProjection,type Issue,type ProjectionResult,type RuleSet,type ValidatedPlan} from '../engine';
import type {EditPreviewOwner} from './edit-types';
export interface EditPreviewWorkerRequest {readonly jobId:number;readonly owner:EditPreviewOwner;readonly token:number;readonly plan:ValidatedPlan;readonly ruleSet:RuleSet}
export interface EditPreviewWorkerReply {readonly jobId:number;readonly owner:EditPreviewOwner;readonly token:number;readonly result:Readonly<{status:'calculated';projection:ProjectionResult}>|Readonly<{status:'failed';issues:readonly Issue[]}>}
export const editCalculationIssues=():readonly Issue[]=>[{code:'calculation-failed',field:'plan',severity:'error',explanation:'These draft inputs could not be calculated. Applied inputs and the previous report have been retained.',resolution:'Review these inputs and retry the preview.'}];
export function calculateEditPreview(request:EditPreviewWorkerRequest):EditPreviewWorkerReply {
  let result:EditPreviewWorkerReply['result'];try{result={status:'calculated',projection:calculateProjection(request.plan,request.ruleSet)};}catch{result={status:'failed',issues:editCalculationIssues()};}
  return {jobId:request.jobId,owner:request.owner,token:request.token,result};
}
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<EditPreviewWorkerRequest>)=>void)|null;postMessage?:(reply:EditPreviewWorkerReply)=>void};
if(typeof document==='undefined'&&typeof scope.postMessage==='function')scope.onmessage=event=>scope.postMessage!(calculateEditPreview(event.data));
