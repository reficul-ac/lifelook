import type {PlanDocument,ProjectionResult} from '../engine';
import type {EditPreviewState} from './edit-types';
import {getRecordLabel} from './issue-presentation';
import type {WorkspaceState} from './state';

export interface ReportSnapshot {
 readonly plan:PlanDocument;
 readonly projection:ProjectionResult;
 readonly comparison:{readonly plan:PlanDocument;readonly projection:ProjectionResult}|null;
 readonly status:'applied'|'preview'|'updating'|'paused'|'failed';
 readonly label:string;
 readonly allowDeltas:boolean;
}

/** Object identity is deliberate: a restore may reuse every ID and revision. */
export function selectReportSnapshot(state:WorkspaceState,preview:EditPreviewState):ReportSnapshot {
 const applied={plan:state.savedPlan,projection:state.projection};
 if(preview.status==='inactive')return {...applied,comparison:null,status:'applied',label:'Applied results',allowDeltas:false};
 const current=preview.current;
 if(preview.status==='valid'&&current&&current.prepared.basePlan===state.savedPlan&&current.projection.inputRevision===current.prepared.plan.revision){
  const target=current.prepared.target,label=target.kind==='allocation'?'Cash flow allocation':getRecordLabel(current.prepared.plan,target.recordId);
  return {plan:current.prepared.plan,projection:current.projection,comparison:applied,status:'preview',label:`Preview · ${label}`,allowDeltas:true};
 }
 const retained=preview.lastValid??(current?{plan:current.prepared.plan,projection:current.projection,basePlan:current.prepared.basePlan}:null);
 const source=retained??applied,status=preview.status==='failed'?'failed':preview.status==='invalid'||preview.status==='stale'?'paused':'updating';
 const label=status==='failed'?'Preview unavailable':status==='paused'?'Preview paused':'Updating';
 return {plan:source.plan,projection:source.projection,comparison:null,status,label:`${label} · ${retained?'previous preview':'applied results'}`,allowDeltas:false};
}
