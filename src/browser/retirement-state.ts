import {createDefaultRetirementAnalysis,validateRetirementAnalysis,validatePlan,type Issue,type ValidatedPlan,type ValidatedRetirementAnalysis,type RuleSet,type ProjectionResult,type RetirementComparison} from '../engine';
import type {RawObject,WorkspaceController,SaveRecordResult} from './state';
import {createRetirementDraft,decodeRetirementDraft,retirementDefinitionSnapshot,type RetirementDraft} from './retirement-draft';
import {equalActiveEdit} from './edit-candidate';
export interface ReadyRetirementEdit {readonly status:'ready';readonly basePlan:ValidatedPlan;readonly plan:ValidatedPlan;readonly ruleSet:RuleSet;readonly definition:ValidatedRetirementAnalysis;readonly controllerEpoch:number;readonly draftGeneration:number;readonly definitionSnapshot:string}
export type PreparedRetirementEdit=ReadyRetirementEdit|Readonly<{status:'unchanged'}>|Readonly<{status:'invalid'|'stale';issues:readonly Issue[]}>;
export type PreparedRetirementWorkspace=Readonly<{status:'ready';plan:ValidatedPlan;ruleSet:RuleSet;definition:ValidatedRetirementAnalysis;definitionFingerprint:string;draftGeneration:number;edit?:ReadyRetirementEdit}>|Readonly<{status:'invalid'|'stale';issues:readonly Issue[]}>;
export interface RetirementCompletedCalculation {readonly projection:ProjectionResult;readonly comparison:RetirementComparison}
export interface RetirementReceipt {readonly prepared:ReadyRetirementEdit;readonly result:RetirementCompletedCalculation}
export interface RetirementViewSelection {candidateYear:number|null;calendarYear:number|null;candidateHorizon:5|10|15|'all';showProjectedComparison:boolean;selectedPropertyId?:string;pathMetric:'after-tax-income'|'stock-balance'|'net-worth'}
export interface RetirementViewSession {analysis:import('./retirement-analysis').RetirementAnalysisViewState;selection:RetirementViewSelection;expanded:Map<string,boolean>;scroll:Map<string,number>}
interface RetirementPort {plan():ValidatedPlan;rules:RuleSet;epoch():number;notify():void;commit(plan:ValidatedPlan,projection:ProjectionResult,accepted:()=>void):SaveRecordResult;reject(issues:readonly Issue[]):SaveRecordResult}
const problem=(code:string,text:string):readonly Issue[]=>[{code,field:'retirementAnalysis',severity:'error',explanation:text,resolution:'Review the current retirement inputs and request a new calculation.'}];
export function createRetirementState(port:RetirementPort){
 let draft:RetirementDraft|undefined,generation=0,result:RetirementCompletedCalculation|undefined;
 const issued=new WeakMap<ReadyRetirementEdit,{raw:string;candidate:string;rules:string;source:string}>(),receipts=new WeakMap<RetirementReceipt,string>(),consumed=new WeakSet<RetirementReceipt>();
 const effective=():ValidatedRetirementAnalysis=>{const plan=port.plan(),checked=validateRetirementAnalysis(plan.retirementAnalysis??createDefaultRetirementAnalysis(plan),plan);if(!checked.ok)throw Error('Invalid applied retirement inputs.');return checked.definition;};
 const getDraft=():RetirementDraft=>structuredClone(draft??{...createRetirementDraft(port.plan()),generation});
 const prepare=():PreparedRetirementEdit=>{
  if(!draft)return {status:'unchanged'};const basePlan=port.plan();if(draft.baseSnapshot!==retirementDefinitionSnapshot(basePlan))return {status:'stale',issues:problem('stale-retirement-draft','The applied retirement definition changed while these raw inputs were open. Your edits have been retained.')};
  const decoded=decodeRetirementDraft(draft,basePlan);if(!decoded.definition)return {status:'invalid',issues:decoded.issues};if(equalActiveEdit(decoded.definition,effective()))return {status:'unchanged'};
  const checked=validatePlan({...basePlan,retirementAnalysis:decoded.definition,revision:basePlan.revision+1});if(!checked.ok)return {status:'invalid',issues:checked.issues};
  const prepared:ReadyRetirementEdit=Object.freeze({status:'ready',basePlan,plan:checked.plan,ruleSet:port.rules,definition:decoded.definition,controllerEpoch:port.epoch(),draftGeneration:generation,definitionSnapshot:JSON.stringify(decoded.definition)});issued.set(prepared,{raw:JSON.stringify(draft),candidate:JSON.stringify(prepared.plan),rules:JSON.stringify(port.rules),source:JSON.stringify(basePlan)});return prepared;
 };
 const fresh=(prepared:ReadyRetirementEdit):boolean=>{const capture=issued.get(prepared);return !!capture&&prepared.basePlan===port.plan()&&prepared.controllerEpoch===port.epoch()&&prepared.draftGeneration===generation&&prepared.ruleSet===port.rules&&capture.raw===JSON.stringify(draft)&&capture.candidate===JSON.stringify(prepared.plan)&&capture.rules===JSON.stringify(port.rules)&&capture.source===JSON.stringify(port.plan())&&prepared.definitionSnapshot===JSON.stringify(prepared.definition);};
 const matches=(prepared:ReadyRetirementEdit,calculation:RetirementCompletedCalculation):boolean=>{
  const {projection,comparison}=calculation,years=Array.from({length:prepared.plan.horizonYears},(_,i)=>prepared.plan.startYear+i).filter(y=>y<=2100);
  return projection.planId===prepared.plan.id&&projection.inputRevision===prepared.plan.revision&&comparison.planId===prepared.plan.id&&comparison.inputRevision===prepared.plan.revision&&comparison.definitionFingerprint===prepared.definitionSnapshot&&JSON.stringify(comparison.candidates.map(c=>c.retirementYear))===JSON.stringify(years)&&comparison.candidates.every(c=>c.firstYear.year===c.retirementYear&&c.strategyId===c.firstYear.strategy);
 };
 const complete=(prepared:ReadyRetirementEdit,calculation:RetirementCompletedCalculation):RetirementReceipt|null=>{if(!fresh(prepared)||!matches(prepared,calculation))return null;const receipt=Object.freeze({prepared,result:calculation});receipts.set(receipt,JSON.stringify(calculation));return receipt;};
 const apply=(receipt:RetirementReceipt):SaveRecordResult=>{
  if(!receipts.has(receipt)||consumed.has(receipt)||!fresh(receipt.prepared)||!matches(receipt.prepared,receipt.result)||receipts.get(receipt)!==JSON.stringify(receipt.result))return port.reject(problem('stale-retirement-preview','This retirement calculation no longer matches the current draft and applied inputs.'));
  const outcome=port.commit(receipt.prepared.plan,receipt.result.projection,()=>{draft=undefined;generation++;result=receipt.result;});if(outcome.accepted)consumed.add(receipt);return outcome;
 };
 return {getDraft,readDraft:()=>draft,readResult:()=>result,prepare,complete,apply,
  edit(next:RetirementDraft){const base=draft?.baseSnapshot??next.baseSnapshot;generation++;draft={...structuredClone(next),generation,baseSnapshot:base};port.notify();},discard(){generation++;draft=undefined;port.notify();},
  reset(){generation++;draft=undefined;result=undefined;},sourceChanged(){result=undefined;},
  workspace(scope:'applied'|'draft'):PreparedRetirementWorkspace{if(scope==='draft'){const prepared=prepare();if(prepared.status==='invalid'||prepared.status==='stale')return prepared;if(prepared.status==='ready')return {status:'ready',plan:prepared.plan,ruleSet:port.rules,definition:prepared.definition,definitionFingerprint:prepared.definitionSnapshot,draftGeneration:generation,edit:prepared};}const definition=effective();return {status:'ready',plan:port.plan(),ruleSet:port.rules,definition,definitionFingerprint:JSON.stringify(definition),draftGeneration:generation};}
 };
}
const bridges=new WeakMap<WorkspaceController,ReturnType<typeof createRetirementState>>();
export function registerRetirementState(controller:WorkspaceController,state:ReturnType<typeof createRetirementState>):void {bridges.set(controller,state);}
const bridge=(controller:WorkspaceController)=>{const state=bridges.get(controller);if(!state)throw Error('Unknown retirement workspace.');return state;};
export const prepareRetirementEdit=(controller:WorkspaceController):PreparedRetirementEdit=>bridge(controller).prepare();
export const prepareRetirementWorkspace=(controller:WorkspaceController,scope:'applied'|'draft'):PreparedRetirementWorkspace=>bridge(controller).workspace(scope);
export const completeRetirementEdit=(controller:WorkspaceController,prepared:ReadyRetirementEdit,result:RetirementCompletedCalculation):RetirementReceipt|null=>bridge(controller).complete(prepared,result);
export const applyRetirementEdit=(controller:WorkspaceController,receipt:RetirementReceipt):SaveRecordResult=>bridge(controller).apply(receipt);
