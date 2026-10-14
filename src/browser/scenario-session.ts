import type {Issue,PlanDocument,ProjectionResult} from '../engine';
import type {InputSection} from './issue-presentation';
import type {ProjectionSummaryRow} from './projection-summary';
import type {WorkspaceController} from './state';
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
