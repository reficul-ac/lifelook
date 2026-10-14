import {validatePlan,type RuleSet,type ValidatedPlan} from '../engine';
import type {BackupPayload} from './workspace-backups';
import {createEditorSession,type EditorPublicationPort} from './state';
import {createEditorViewSession,normalizeViewYears,type ScenarioEditorSession,type ScenarioViewSelections} from './scenario-session';
import {createScenarioWorkspace,validateScenarioName,validateScenarioWorkspace,workspaceIssue,type ScenarioDocument,type ScenarioWorkspaceDocument,type WorkspaceIssue} from './scenario-workspace';
import {saveWorkspace,exportWorkspace as serializeWorkspace,WORKSPACE_STORAGE_KEY,type WorkspacePersistence} from './workspace-storage';
import {exportPlan,type StoragePort} from './storage';
export interface ScenarioTarget {scenarioId:string;generation:number;workspaceGeneration:number}
export interface ScenarioOperationResult {accepted:boolean;persisted:boolean;issues:readonly WorkspaceIssue[];scenarioId?:string}
export interface ScenarioManagerState {document:ScenarioWorkspaceDocument;persistence:WorkspacePersistence;workspaceGeneration:number;activeSession:ScenarioEditorSession}
export interface ScenarioManager {
 getState():ScenarioManagerState;getSession(id:string):ScenarioEditorSession|undefined;getActiveSession():ScenarioEditorSession;
 captureTarget(id:string):ScenarioTarget|undefined;isCurrentTarget(target:ScenarioTarget):boolean;
 switchScenario(id:string):ScenarioOperationResult;forkScenario(source:ScenarioTarget,name:string):ScenarioOperationResult;renameScenario(id:string,name:string):ScenarioOperationResult;deleteScenario(target:ScenarioTarget):ScenarioOperationResult;
 importScenario(plan:ValidatedPlan,name:string):ScenarioOperationResult;replaceScenario(target:ScenarioTarget,plan:ValidatedPlan):ScenarioOperationResult;restoreWorkspace(document:ScenarioWorkspaceDocument):ScenarioOperationResult;replaceUnreadableData(payload:BackupPayload):ScenarioOperationResult;retryRecoveryReplacement():ScenarioOperationResult;exportScenario(id:string):string;exportWorkspace():string;
 retryLocalSave():ScenarioOperationResult;observeExternalStorage(raw:string|null):void;subscribe(listener:()=>void):()=>void;dispose():void;
}
export function createScenarioManager(input:ScenarioWorkspaceDocument,storage:StoragePort,rules:RuleSet,initial:WorkspacePersistence,nextScenarioId?:()=>string):ScenarioManager {
 const validated=validateScenarioWorkspace(input);if(!validated.ok)throw Error('A valid workspace is required.');
 let document=validated.document,persistence=initial,workspaceGeneration=1,sequence=0,disposed=false,recoveryReplacementPending=false;
 let idSequence=0;const allocateId=nextScenarioId??(()=>globalThis.crypto?.randomUUID?.()??`scenario-${++idSequence}`);
 const generations=new Map(document.scenarios.map(s=>[s.id,++sequence])),sessions=new Map<string,ScenarioEditorSession>(),subscriptions=new Map<string,()=>void>(),listeners=new Set<()=>void>();
 const notify=()=>{if(!disposed)listeners.forEach(fn=>fn());};
 const row=(id:string)=>document.scenarios.find(s=>s.id===id);
 const outcome=(accepted:boolean,issues:readonly WorkspaceIssue[]=[],scenarioId?:string):ScenarioOperationResult=>({accepted,persisted:persistence.persisted,issues,...(scenarioId?{scenarioId}:{})});
 const reject=(code:string,message:string)=>outcome(false,[workspaceIssue(code,'workspace',message)]);
 const current=(target:ScenarioTarget)=>!disposed&&target.workspaceGeneration===workspaceGeneration&&generations.get(target.scenarioId)===target.generation&&!!row(target.scenarioId);
 const capture=(id:string):ScenarioTarget|undefined=>row(id)&&!disposed?{scenarioId:id,generation:generations.get(id)!,workspaceGeneration}:undefined;
 const canIncrement=()=>!disposed&&document.workspaceRevision<Number.MAX_SAFE_INTEGER;
 const persist=()=>{
  if(persistence.suspension!=='none'||persistence.observedRaw===undefined){persistence={...persistence,persisted:false};return;}
  const result=saveWorkspace(storage,document,persistence.observedRaw);
  persistence={...persistence,persisted:result.status==='saved',persistenceIssues:result.issues,observedRaw:result.observedRaw,suspension:result.status==='external-change'?'external-change':result.status==='read-failed'?'unreadable':'none'};
 };
 const commit=(candidate:ScenarioWorkspaceDocument)=>{const checked=validateScenarioWorkspace(candidate);if(!checked.ok)return outcome(false,checked.issues);document=checked.document;persist();notify();return outcome(true,[],document.activeScenarioId);};
 const build=(scenario:ScenarioDocument,generation:number,selections?:ScenarioViewSelections,ownerWorkspaceGeneration=workspaceGeneration):ScenarioEditorSession=>{
  const target:ScenarioTarget={scenarioId:scenario.id,generation,workspaceGeneration:ownerWorkspaceGeneration};
  const port:EditorPublicationPort={readPersistence:()=>persistence,
   publish(plan,_projection,commitSession){
    if(!current(target))return {accepted:false,issues:[workspaceIssue('obsolete-scenario','workspace','This editor no longer owns a current scenario.')]};
    if(!canIncrement())return {accepted:false,issues:[workspaceIssue('revision-overflow','workspaceRevision','The workspace revision cannot be incremented safely.')]};
    const checked=validateScenarioWorkspace({...document,workspaceRevision:document.workspaceRevision+1,scenarios:document.scenarios.map(s=>s.id===scenario.id?{...s,plan}:s)});
    if(!checked.ok)return {accepted:false,issues:checked.issues};
    document=checked.document;commitSession();normalizeViewYears(session.view,plan);persist();return {accepted:true};
   },retry(){if(!current(target))return {accepted:false,issues:[workspaceIssue('obsolete-scenario','workspace','This editor is obsolete.')]};const result=retry(false);return result.accepted?{accepted:true}:{accepted:false,issues:result.issues};}};
  const controller=createEditorSession(scenario.plan,port,rules),session:ScenarioEditorSession={scenarioId:scenario.id,generation,controller,view:createEditorViewSession(scenario.plan,selections)};return session;
 };
 const retain=(session:ScenarioEditorSession)=>{subscriptions.get(session.scenarioId)?.();sessions.set(session.scenarioId,session);subscriptions.set(session.scenarioId,session.controller.subscribe(()=>{normalizeViewYears(session.view,session.controller.getState().savedPlan);notify();}));};
 const prepare=(id:string):ScenarioEditorSession=>{const existing=sessions.get(id);if(existing)return existing;const scenario=row(id);if(!scenario)throw Error('Scenario missing');return build(scenario,generations.get(id)!);};
 const retry=(announce=true)=>{if(disposed||persistence.suspension!=='none'||persistence.observedRaw===undefined)return reject('persistence-suspended','Saving is suspended. Export the workspace and reload or replace unreadable saved data.');persist();if(announce)notify();return outcome(true,persistence.persistenceIssues);};

 // Restore checks precede live replacement; ordinary edits can remain local during suspension.
 const restoreObservation=():{ok:true;raw:string|null}|{ok:false;result:ScenarioOperationResult}=>{
  if(disposed||persistence.suspension==='external-change')return {ok:false,result:reject('persistence-suspended','Export your workspace and reload before restoring saved data.')};
  let raw:string|null;try{raw=storage.getItem(WORKSPACE_STORAGE_KEY);}catch{persistence={...persistence,persisted:false,suspension:'unreadable',persistenceIssues:[workspaceIssue('storage-read-failed','storage','Saved data could not be read before replacement. Current inputs and drafts are retained.')]};notify();return {ok:false,result:outcome(false,persistence.persistenceIssues)};}
  if(persistence.observedRaw!==undefined&&raw!==persistence.observedRaw){manager.observeExternalStorage(raw);return {ok:false,result:outcome(false,persistence.persistenceIssues)};}
  return {ok:true,raw};
 };
 const persistReplacement=(expected:string|null,recovering:boolean)=>{
  const saved=saveWorkspace(storage,document,expected);
  persistence={...persistence,persisted:saved.status==='saved',persistenceIssues:saved.issues,observedRaw:saved.observedRaw,suspension:saved.status==='external-change'?'external-change':saved.status==='read-failed'||recovering&&saved.status!=='saved'?'unreadable':'none'};
  recoveryReplacementPending=recovering&&saved.status!=='saved';
 };
 const restore=(input:ScenarioWorkspaceDocument,deliberateRecovery=false):ScenarioOperationResult=>{
  const checked=validateScenarioWorkspace(input);if(!checked.ok)return outcome(false,checked.issues);
  const revision=Math.max(document.workspaceRevision,checked.document.workspaceRevision)+1;
  if(disposed||!Number.isSafeInteger(revision))return reject('revision-overflow','The restored workspace revision cannot be incremented safely.');
  const observation=restoreObservation();if(!observation.ok)return observation.result;
  const recovering=deliberateRecovery||persistence.suspension==='unreadable',nextWorkspaceGeneration=workspaceGeneration+1,nextGenerations=new Map(checked.document.scenarios.map(s=>[s.id,++sequence]));
  let prepared:ScenarioEditorSession;try{prepared=build(checked.document.scenarios.find(s=>s.id===checked.document.activeScenarioId)!,nextGenerations.get(checked.document.activeScenarioId)!,undefined,nextWorkspaceGeneration);}catch{return reject('calculation-failed','The imported active scenario could not be calculated. Current inputs and drafts are retained.');}
  if(recovering&&!persistence.recovery&&observation.raw!==null)persistence={...persistence,recovery:{key:WORKSPACE_STORAGE_KEY,raw:observation.raw}};
  subscriptions.forEach(fn=>fn());subscriptions.clear();sessions.clear();generations.clear();nextGenerations.forEach((value,key)=>generations.set(key,value));workspaceGeneration=nextWorkspaceGeneration;
  document={...checked.document,workspaceRevision:revision};retain(prepared);persistReplacement(observation.raw,recovering);notify();return outcome(true,[],document.activeScenarioId);
 };
 retain(prepare(document.activeScenarioId));
 const manager:ScenarioManager={
  getState:()=>({document,persistence,workspaceGeneration,activeSession:sessions.get(document.activeScenarioId)!}),getSession:id=>sessions.get(id),getActiveSession:()=>sessions.get(document.activeScenarioId)!,captureTarget:capture,isCurrentTarget:current,
  switchScenario(id){if(disposed||!row(id))return reject('missing-scenario','This scenario is no longer available.');if(id===document.activeScenarioId)return outcome(true);if(!canIncrement())return reject('revision-overflow','Workspace revision cannot be incremented.');let prepared:ScenarioEditorSession;try{prepared=prepare(id);}catch{return reject('calculation-failed','The selected scenario could not be calculated. The current scenario remains active.');}retain(prepared);return commit({...document,workspaceRevision:document.workspaceRevision+1,activeScenarioId:id});},
  forkScenario(source,name){if(!current(source))return reject('obsolete-scenario','The source scenario changed. Reopen the fork dialog.');const named=validateScenarioName(name,document.scenarios);if(!named.ok)return outcome(false,named.issues);if(!canIncrement())return reject('revision-overflow','Workspace revision cannot be incremented.');let id:string;try{id=allocateId();}catch{return reject('invalid-scenario-id','A new scenario ID could not be created.');}if(!id.trim()||row(id))return reject('duplicate-scenario-id','The new scenario ID must be unique.');
   const original=row(source.scenarioId)!,scenario:ScenarioDocument={id,name:named.name,plan:structuredClone(original.plan),forkedFrom:{scenarioId:original.id,scenarioName:original.name,planRevision:original.plan.revision}},generation=++sequence;
   let session:ScenarioEditorSession;try{session=build(scenario,generation,sessions.get(source.scenarioId)?.view.selections);}catch{return reject('calculation-failed','The fork could not be calculated. Source inputs and drafts are retained.');}
   const checked=validateScenarioWorkspace({...document,workspaceRevision:document.workspaceRevision+1,activeScenarioId:id,scenarios:[...document.scenarios,scenario]});if(!checked.ok)return outcome(false,checked.issues);generations.set(id,generation);retain(session);return commit(checked.document);
  },
  renameScenario(id,name){const scenario=row(id);if(!scenario||disposed)return reject('missing-scenario','Scenario no longer available.');const named=validateScenarioName(name,document.scenarios,id);if(!named.ok)return outcome(false,named.issues);if(named.name===scenario.name)return outcome(true);if(!canIncrement())return reject('revision-overflow','Workspace revision cannot be incremented.');return commit({...document,workspaceRevision:document.workspaceRevision+1,scenarios:document.scenarios.map(s=>s.id===id?{...s,name:named.name}:s)});},
  deleteScenario(target){if(!current(target))return reject('obsolete-scenario','Scenario no longer available.');if(target.scenarioId===document.baselineScenarioId)return reject('baseline-protected','The baseline cannot be deleted.');if(!canIncrement())return reject('revision-overflow','Workspace revision cannot be incremented.');const active=document.activeScenarioId===target.scenarioId?document.baselineScenarioId:document.activeScenarioId;
   if(active!==document.activeScenarioId){let session:ScenarioEditorSession;try{session=prepare(active);}catch{return reject('calculation-failed','The baseline could not be prepared. The experiment is retained.');}retain(session);}
   subscriptions.get(target.scenarioId)?.();subscriptions.delete(target.scenarioId);sessions.delete(target.scenarioId);generations.delete(target.scenarioId);return commit({...document,workspaceRevision:document.workspaceRevision+1,activeScenarioId:active,scenarios:document.scenarios.filter(s=>s.id!==target.scenarioId)});
  },
  importScenario(plan,name){
   const checkedPlan=validatePlan(plan);if(!checkedPlan.ok)return outcome(false,checkedPlan.issues);const named=validateScenarioName(name,document.scenarios);if(!named.ok)return outcome(false,named.issues);if(!canIncrement())return reject('revision-overflow','Workspace revision cannot be incremented.');
   let id:string;try{id=allocateId();}catch{return reject('invalid-scenario-id','A new scenario ID could not be created.');}if(!id.trim()||row(id))return reject('duplicate-scenario-id','The imported scenario ID must be unique.');
   const scenario:ScenarioDocument={id,name:named.name,plan:checkedPlan.plan},generation=++sequence;let prepared:ScenarioEditorSession;try{prepared=build(scenario,generation);}catch{return reject('calculation-failed','The imported scenario could not be calculated. Current scenarios and drafts are retained.');}
   generations.set(id,generation);retain(prepared);return commit({...document,workspaceRevision:document.workspaceRevision+1,activeScenarioId:id,scenarios:[...document.scenarios,scenario]});
  },
  replaceScenario(target,plan){
   if(!current(target))return reject('obsolete-scenario','This scenario has been replaced or deleted. Choose the file again.');const checked=validatePlan(plan);if(!checked.ok)return outcome(false,checked.issues);if(!canIncrement())return reject('revision-overflow','Workspace revision cannot be incremented.');
   // Only whole-workspace recovery can release protection of unreadable saved bytes.
   if(persistence.suspension==='unreadable')return reject('persistence-suspended','Use Replace unreadable saved data to replace protected saved bytes.');
   const observation=restoreObservation();if(!observation.ok)return observation.result;const scenario={...row(target.scenarioId)!,plan:checked.plan},generation=++sequence;let prepared:ScenarioEditorSession;try{prepared=build(scenario,generation,sessions.get(target.scenarioId)?.view.selections);}catch{return reject('calculation-failed','The imported plan could not be calculated. Current inputs and drafts are retained.');}
   generations.set(target.scenarioId,generation);retain(prepared);document={...document,workspaceRevision:document.workspaceRevision+1,scenarios:document.scenarios.map(s=>s.id===target.scenarioId?scenario:s)};persistReplacement(observation.raw,false);notify();return outcome(true,[],target.scenarioId);
  },
  restoreWorkspace:input=>restore(input),
  replaceUnreadableData(payload){if(persistence.suspension!=='unreadable')return reject('persistence-suspended','Unreadable-data replacement is available only while protecting unreadable saved data.');
   if(payload.kind==='workspace')return restore(payload.document,true);const checked=validatePlan(payload.plan);if(!checked.ok)return outcome(false,checked.issues);let baseline:string;try{baseline=allocateId();}catch{return reject('invalid-scenario-id','A baseline ID could not be created.');}let replacement:ScenarioWorkspaceDocument;try{replacement=createScenarioWorkspace(checked.plan,baseline);}catch{return reject('invalid-workspace','A valid replacement workspace is required.');}return restore(replacement,true);
  },
  retryRecoveryReplacement(){if(!recoveryReplacementPending||persistence.suspension!=='unreadable')return reject('persistence-suspended','There is no pending unreadable-data replacement to retry.');const observation=restoreObservation();if(!observation.ok)return observation.result;persistReplacement(observation.raw,true);notify();return outcome(true,persistence.persistenceIssues);},
  exportScenario(id){const scenario=row(id);if(!scenario)throw Error('Scenario no longer available.');return exportPlan(scenario.plan);},exportWorkspace:()=>serializeWorkspace(document),
  retryLocalSave:()=>retry(),observeExternalStorage(raw){if(disposed||raw===persistence.observedRaw||persistence.suspension==='external-change')return;persistence={...persistence,persisted:false,suspension:'external-change',persistenceIssues:[workspaceIssue('external-workspace-change','storage','The saved workspace changed in another tab. Export your local workspace and reload before saving.')]};notify();},
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},dispose(){if(disposed)return;disposed=true;subscriptions.forEach(fn=>fn());subscriptions.clear();listeners.clear();}
 };return manager;
}
