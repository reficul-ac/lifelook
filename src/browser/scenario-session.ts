import type {Destination} from './workspace-route';
import type {ReportViewState} from './views/report-state';
import type {RecordEditorMemory} from './record-ui-state';
import type {AduComparisonViewState} from './adu-comparison';
import type {Issue,PlanDocument,ProjectionResult} from '../engine';
import type {InputSection} from './issue-presentation';
import type {ProjectionSummaryRow} from './projection-summary';
import type {WorkspaceController,WorkspaceState} from './state';
export type ForecastPlotSeriesKey=Exclude<keyof ProjectionSummaryRow,'year'>;
export interface ScenarioViewSelections {destination:Destination;inputSection:InputSection;forecastYear:number;allocationYear:number;hiddenPlotSeries:Set<ForecastPlotSeriesKey>}
export interface AllocationPreviewSession {lastValid?:{plan:PlanDocument;projection:ProjectionResult;basePlan?:PlanDocument};status:'pending'|'valid'|'invalid'|'failed'|'inactive';issues:readonly Issue[];entryIdSequence:number}
export interface EditorViewSession {editorMemory:Map<string,RecordEditorMemory>;reportState:ReportViewState;selectedAduProjectId?:string;aduComparison:AduComparisonViewState;selections:ScenarioViewSelections;allocationPreview:AllocationPreviewSession;taskIssues:Map<string,readonly Issue[]>;removeIssues:Map<string,readonly Issue[]>;propertyDisclosures:Map<string,boolean>}
export interface ScenarioEditorSession {scenarioId:string;generation:number;controller:WorkspaceController;view:EditorViewSession}
export interface PreviewOwner {scenarioId:string;sessionGeneration:number;activationGeneration:number}
export function createEditorViewSession(plan:PlanDocument,selections?:ScenarioViewSelections):EditorViewSession {
  const selected=plan.properties.find(p=>p.aduProject)?.aduProject?.id;
  const view:EditorViewSession={editorMemory:new Map(),reportState:{tableView:'balance-sheet',expanded:new Set(),scroll:new Map()},...(selected?{selectedAduProjectId:selected}:{}),aduComparison:{status:'inactive',issues:[]},selections:selections?{...selections,destination:'overview',hiddenPlotSeries:new Set(selections.hiddenPlotSeries)}:{destination:'overview',inputSection:'Household',forecastYear:plan.startYear,allocationYear:plan.startYear,hiddenPlotSeries:new Set()},allocationPreview:{status:'inactive',issues:[],entryIdSequence:0},taskIssues:new Map(),removeIssues:new Map(),propertyDisclosures:new Map()};normalizeViewYears(view,plan);return view;
}
export function normalizeViewYears(view:EditorViewSession,plan:PlanDocument):void {
  if(view.selectedAduProjectId&&!plan.properties.some(p=>p.aduProject?.id===view.selectedAduProjectId)){delete view.selectedAduProjectId;view.aduComparison={status:'inactive',issues:[]};}
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
    if(state.savedPlan!==previous.savedPlan){view.aduComparison={status:'inactive',issues:[]};if(!previous.savedPlan.properties.some(p=>p.aduProject)){const first=state.savedPlan.properties.find(p=>p.aduProject)?.aduProject?.id;if(first)view.selectedAduProjectId=first;}}
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
