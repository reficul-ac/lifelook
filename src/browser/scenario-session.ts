import type {Issue,PlanDocument,ProjectionResult} from '../engine';
import type {InputSection} from './issue-presentation';
import type {ProjectionSummaryRow} from './projection-summary';
import type {WorkspaceController,WorkspaceState} from './state';
export type ForecastPlotSeriesKey=Exclude<keyof ProjectionSummaryRow,'year'>;
export interface ScenarioViewSelections {inputSection:InputSection;forecastYear:number;allocationYear:number;hiddenPlotSeries:Set<ForecastPlotSeriesKey>}
export interface AllocationPreviewSession {lastValid?:{plan:PlanDocument;projection:ProjectionResult};status:'pending'|'valid'|'invalid'|'failed'|'inactive';issues:readonly Issue[];entryIdSequence:number}
export interface EditorViewSession {selections:ScenarioViewSelections;allocationPreview:AllocationPreviewSession;taskIssues:Map<string,readonly Issue[]>;removeIssues:Map<string,readonly Issue[]>;propertyDisclosures:Map<string,boolean>}
export interface ScenarioEditorSession {scenarioId:string;generation:number;controller:WorkspaceController;view:EditorViewSession}
export interface PreviewOwner {scenarioId:string;sessionGeneration:number;activationGeneration:number}
export function createEditorViewSession(plan:PlanDocument,selections?:ScenarioViewSelections):EditorViewSession {
  const view:EditorViewSession={selections:selections?{...selections,hiddenPlotSeries:new Set(selections.hiddenPlotSeries)}:{inputSection:'Household',forecastYear:plan.startYear,allocationYear:plan.startYear,hiddenPlotSeries:new Set()},allocationPreview:{status:'inactive',issues:[],entryIdSequence:0},taskIssues:new Map(),removeIssues:new Map(),propertyDisclosures:new Map()};normalizeViewYears(view,plan);return view;
}
export function normalizeViewYears(view:EditorViewSession,plan:PlanDocument):void {
  for(const key of ['forecastYear','allocationYear'] as const){const year=view.selections[key];if(!Number.isInteger(year)||year<plan.startYear||year>=plan.startYear+plan.horizonYears)view.selections[key]=plan.startYear;}
}

/** Retained state follows its controller even while its browser view is unmounted. */
export function retainEditorView(controller:WorkspaceController,view:EditorViewSession,notify:()=>void):()=>void {
  let previous=controller.getState();
  const appliedPreview=(state:WorkspaceState)=>{
    const preview=view.allocationPreview;
    if(state.savedPlan.cashFlowAllocation)preview.lastValid={plan:state.savedPlan,projection:state.projection};
    else delete preview.lastValid;
    preview.status=preview.lastValid?'valid':'inactive';preview.issues=[];
  };
  if(!previous.allocationDraft)appliedPreview(previous);
  return controller.subscribe(operation=>{
    const state=controller.getState();normalizeViewYears(view,state.savedPlan);
    for(const map of [view.taskIssues,view.removeIssues])for(const id of map.keys())if(state.drafts[id]!==previous.drafts[id])map.delete(id);
    if(operation&&operation.kind!=='restore'){
      if(operation.result.accepted){view.taskIssues.delete(operation.recordId);view.removeIssues.delete(operation.recordId);}
      else (operation.kind==='save'?view.taskIssues:view.removeIssues).set(operation.recordId,operation.result.issues);
    }
    if(state.savedPlan!==previous.savedPlan||state.allocationDraft!==previous.allocationDraft){
      if(!state.allocationDraft)appliedPreview(state);
      else {view.allocationPreview.status='pending';view.allocationPreview.issues=[];}
    }
    if(operation?.kind==='save'&&!operation.result.accepted&&operation.recordId===state.allocationDraft?.recordId){
      view.allocationPreview.issues=operation.result.issues;
      view.allocationPreview.status=operation.result.issues.some(issue=>issue.code==='calculation-failed')?'failed':'invalid';
    }
    previous=state;notify();
  });
}
