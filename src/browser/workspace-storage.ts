import {validatePlan} from '../engine';
import {PLAN_STORAGE_KEY,type StoragePort} from './storage';
import type {WorkspaceInitialization} from './state';
import {createScenarioWorkspace,validateScenarioWorkspace,workspaceIssue,type ScenarioWorkspaceDocument,type WorkspaceIssue} from './scenario-workspace';
export const WORKSPACE_STORAGE_KEY='lifelook.foundation.workspace.v1';
export interface WorkspacePersistence extends WorkspaceInitialization {readonly observedRaw:string|null|undefined;readonly suspension:'none'|'unreadable'|'external-change';readonly recovery?:{key:string;raw:string}}
export type WorkspaceLoadResult={status:'loaded'|'migrated';document:ScenarioWorkspaceDocument;persistence:WorkspacePersistence}|{status:'missing'|'invalid'|'read-failed';persistence:WorkspacePersistence};
export interface WorkspaceSaveResult {status:'saved'|'invalid'|'write-failed'|'read-failed'|'external-change';observedRaw:string|null;issues:readonly WorkspaceIssue[]}
export function exportWorkspace(document:ScenarioWorkspaceDocument):string{return JSON.stringify(document,null,2);}
export function saveWorkspace(storage:StoragePort,document:ScenarioWorkspaceDocument,expectedRaw:string|null):WorkspaceSaveResult {
  const validated=validateScenarioWorkspace(document);if(!validated.ok)return {status:'invalid',observedRaw:expectedRaw,issues:validated.issues};
  let current:string|null;
  try{current=storage.getItem(WORKSPACE_STORAGE_KEY);}catch{return {status:'read-failed',observedRaw:expectedRaw,issues:[workspaceIssue('storage-read-failed','storage','The browser could not read the saved workspace. Saving is suspended to protect unseen data.')]};}
  if(current!==expectedRaw)return {status:'external-change',observedRaw:expectedRaw,issues:[workspaceIssue('external-workspace-change','storage','The saved workspace changed in another tab. Export your local workspace and reload before saving.')]};
  const json=exportWorkspace(validated.document);
  try{storage.setItem(WORKSPACE_STORAGE_KEY,json);return {status:'saved',observedRaw:json,issues:[]};}
  catch{return {status:'write-failed',observedRaw:expectedRaw,issues:[workspaceIssue('storage-write-failed','storage','This workspace remains in memory, but the browser could not save it. Export a workspace backup or retry local save.')]};}
}
export function loadWorkspace(storage:StoragePort,nextScenarioId:()=>string):WorkspaceLoadResult {
  let observation:string|null|undefined;
  const readFailed=():WorkspaceLoadResult=>({status:'read-failed',persistence:{persisted:false,persistenceIssues:[workspaceIssue('storage-read-failed','storage','The browser could not read saved data. Saving is suspended to protect unseen data.')],observedRaw:observation,suspension:'unreadable'}});
  try{observation=storage.getItem(WORKSPACE_STORAGE_KEY);}catch{return readFailed();}
  let key=WORKSPACE_STORAGE_KEY,raw=observation;
  if(raw===null){key=PLAN_STORAGE_KEY;try{raw=storage.getItem(key);}catch{return readFailed();}}
  if(raw===null)return {status:'missing',persistence:{persisted:false,persistenceIssues:[],observedRaw:null,suspension:'none'}};
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{parsed=undefined;}
  const validated=key===WORKSPACE_STORAGE_KEY?validateScenarioWorkspace(parsed):validatePlan(parsed);
  if(!validated.ok)return {status:'invalid',persistence:{persisted:false,persistenceIssues:validated.issues,observedRaw:observation,suspension:'unreadable',recovery:{key,raw}}};
  if('document' in validated)return {status:'loaded',document:validated.document,persistence:{persisted:true,persistenceIssues:[],observedRaw:observation,suspension:'none'}};
  const document=createScenarioWorkspace(validated.plan,nextScenarioId()),saved=saveWorkspace(storage,document,null);
  return {status:'migrated',document,persistence:{persisted:saved.status==='saved',persistenceIssues:saved.issues,observedRaw:saved.observedRaw,suspension:saved.status==='external-change'?'external-change':saved.status==='read-failed'?'unreadable':'none'}};
}
