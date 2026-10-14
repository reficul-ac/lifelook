import {validatePlan,type ValidatedPlan} from '../engine';
import {validateScenarioWorkspace,workspaceIssue,type ScenarioWorkspaceDocument,type WorkspaceIssue} from './scenario-workspace';
export type BackupPayload={kind:'plan';plan:ValidatedPlan}|{kind:'workspace';document:ScenarioWorkspaceDocument};
export function parseBackup(json:string,expected:'plan'|'workspace'|'either'):{ok:true;payload:BackupPayload}|{ok:false;issues:readonly WorkspaceIssue[]}{
 let raw:unknown;try{raw=JSON.parse(json);}catch{return {ok:false,issues:[workspaceIssue('invalid-backup-json','backup','The backup is not valid JSON.')]};}
 const kind=raw&&typeof raw==='object'&&'kind' in raw?raw.kind:undefined;
 if(kind==='lifelook-workspace'){
  if(expected==='plan')return {ok:false,issues:[workspaceIssue('wrong-backup-scope','backup','Choose a plain scenario JSON for this action.')]};
  const result=validateScenarioWorkspace(raw);return result.ok?{ok:true,payload:{kind:'workspace',document:result.document}}:result;
 }
 if(expected==='workspace'||kind!==undefined)return {ok:false,issues:[workspaceIssue('wrong-backup-scope','backup','Choose a LifeLook workspace backup for this action.')]};
 const result=validatePlan(raw);return result.ok?{ok:true,payload:{kind:'plan',plan:result.plan}}:result;
}
