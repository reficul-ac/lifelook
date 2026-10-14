import {validatePlan,type Issue,type PlanDocument} from '../engine';
export interface ScenarioDocument {
  readonly id:string; readonly name:string; readonly plan:PlanDocument;
  readonly forkedFrom?:Readonly<{scenarioId:string;scenarioName:string;planRevision:number}>;
}
export interface ScenarioWorkspaceDocument {
  readonly kind:'lifelook-workspace'; readonly schemaVersion:1; readonly workspaceRevision:number;
  readonly baselineScenarioId:string; readonly activeScenarioId:string; readonly scenarios:readonly ScenarioDocument[];
}
export interface WorkspaceIssue extends Issue {readonly scenarioId?:string;readonly scenarioName?:string}
export const workspaceIssue=(code:string,field:string,explanation:string):WorkspaceIssue=>({code,field,severity:'error',explanation,resolution:'Correct the indicated workspace input. Existing inputs and drafts are retained.'});
export function validateScenarioName(input:string,scenarios:readonly ScenarioDocument[],excludeId?:string):{ok:true;name:string}|{ok:false;issues:readonly WorkspaceIssue[]}{
  const name=input.trim();
  if(!name||Array.from(name).length>80)return {ok:false,issues:[workspaceIssue('invalid-scenario-name','name','Enter a scenario name with 1 through 80 characters.')]};
  if(scenarios.some(s=>s.id!==excludeId&&s.name.trim().toLowerCase()===name.toLowerCase()))return {ok:false,issues:[workspaceIssue('duplicate-scenario-name','name','A scenario already uses this name.')]};
  return {ok:true,name};
}
export function suggestForkName(sourceName:string,scenarios:readonly ScenarioDocument[]):string {
  for(let n=1;;n++){const suffix=n===1?' copy':` copy ${n}`,name=Array.from(sourceName).slice(0,80-Array.from(suffix).length).join('')+suffix;if(validateScenarioName(name,scenarios).ok)return name;}
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const revision=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function validateScenarioWorkspace(raw:unknown):{ok:true;document:ScenarioWorkspaceDocument}|{ok:false;issues:readonly WorkspaceIssue[]}{
  if(!object(raw))return {ok:false,issues:[workspaceIssue('invalid-workspace','workspace','A workspace object is required.')]};
  const issues:WorkspaceIssue[]=[],rows:ScenarioDocument[]=[],ids=new Set<string>();
  const invalid=(field:string,message:string)=>issues.push(workspaceIssue('invalid-workspace',field,message));
  if(raw.kind!=='lifelook-workspace')invalid('kind','Choose a LifeLook workspace backup.');
  if(raw.schemaVersion!==1)invalid('schemaVersion','This workspace version is unsupported.');
  if(!revision(raw.workspaceRevision))invalid('workspaceRevision','Workspace revision must be a nonnegative safe integer.');
  if(!Array.isArray(raw.scenarios)||!raw.scenarios.length)invalid('scenarios','At least one scenario is required.');
  if(Array.isArray(raw.scenarios))raw.scenarios.forEach((row:unknown,index:number)=>{
    const prefix=`scenarios[${index}]`;
    if(!object(row)){invalid(prefix,'A scenario object is required.');return;}
    if(!text(row.id)||ids.has(row.id))invalid(`${prefix}.id`,'Scenario IDs must be nonempty and unique.');
    if(text(row.id))ids.add(row.id);
    if(typeof row.name!=='string')invalid(`${prefix}.name`,'A scenario name is required.');
    else {const checked=validateScenarioName(row.name,rows);if(!checked.ok)issues.push(...checked.issues.map(i=>({...i,field:`${prefix}.name`})));else if(checked.name!==row.name)invalid(`${prefix}.name`,'Stored names must not contain outer whitespace.');}
    if(row.forkedFrom!==undefined){const f=row.forkedFrom;if(!object(f)||!text(f.scenarioId)||!text(f.scenarioName)||!revision(f.planRevision))invalid(`${prefix}.forkedFrom`,'Fork history requires a source ID, name and safe revision.');}
    const validated=validatePlan(row.plan);
    if(!validated.ok)issues.push(...validated.issues.map(i=>({...i,field:`${prefix}.plan${i.field?'.'+i.field:''}`,...(text(row.id)?{scenarioId:row.id}:{}),...(typeof row.name==='string'?{scenarioName:row.name}:{})})));
    else if(text(row.id)&&typeof row.name==='string')rows.push({id:row.id,name:row.name,plan:validated.plan,...(object(row.forkedFrom)?{forkedFrom:structuredClone(row.forkedFrom) as unknown as NonNullable<ScenarioDocument['forkedFrom']>}:{})});
  });
  if(!text(raw.baselineScenarioId)||!ids.has(raw.baselineScenarioId))invalid('baselineScenarioId','Baseline must refer to a scenario.');
  if(!text(raw.activeScenarioId)||!ids.has(raw.activeScenarioId))invalid('activeScenarioId','Active selection must refer to a scenario.');
  return issues.length?{ok:false,issues}:{ok:true,document:freeze({kind:'lifelook-workspace',schemaVersion:1,workspaceRevision:raw.workspaceRevision as number,baselineScenarioId:raw.baselineScenarioId as string,activeScenarioId:raw.activeScenarioId as string,scenarios:rows})};
}
export function createScenarioWorkspace(plan:PlanDocument,baselineId:string):ScenarioWorkspaceDocument {
  const result=validateScenarioWorkspace({kind:'lifelook-workspace',schemaVersion:1,workspaceRevision:0,baselineScenarioId:baselineId,activeScenarioId:baselineId,scenarios:[{id:baselineId,name:'Master',plan}]});
  if(!result.ok)throw new Error('A valid plan and baseline ID are required.');return result.document;
}
