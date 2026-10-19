import type {Issue,PlanDocument,ProjectionResult,RuleSet,ValidatedPlan} from '../engine';
import type {EditableSection,SaveRecordResult} from './state';
import type {PreviewOwner} from './scenario-session';
export type EditTarget=Readonly<{kind:'record';section:EditableSection;recordId:string}>|Readonly<{kind:'allocation'}>;
export interface ReadyEdit {readonly status:'ready';readonly target:EditTarget;readonly plan:ValidatedPlan;readonly basePlan:ValidatedPlan;readonly ruleSet:RuleSet;readonly controllerEpoch:number;readonly draftGeneration:number;readonly token:number}
export type PreparedEdit=ReadyEdit|Readonly<{status:'unchanged'}>|Readonly<{status:'invalid'|'stale';issues:readonly Issue[]}>;
export interface CalculatedEdit {readonly prepared:ReadyEdit;readonly projection:ProjectionResult}
export interface EditPreviewOwner extends PreviewOwner {readonly workspaceGeneration:number}
export interface PreviewReport {readonly plan:PlanDocument;readonly projection:ProjectionResult;readonly basePlan:PlanDocument|null}
export interface EditPreviewState {readonly status:'inactive'|'pending'|'valid'|'invalid'|'stale'|'failed';readonly target:EditTarget|null;readonly current:CalculatedEdit|null;readonly lastValid:PreviewReport|null;readonly issues:readonly Issue[]}
export interface EditPreviewCoordinator {getState():EditPreviewState;subscribe(listener:(state:EditPreviewState)=>void):()=>void;select(target:EditTarget|null):void;request(flush?:boolean):void;apply():SaveRecordResult;discard():void;dispose():void}
