import {createPlan,loadRuleSet} from '../engine';
import {createScenarioWorkspace} from './scenario-workspace';
import {createScenarioManager,type ScenarioManager} from './scenario-manager';
import {loadWorkspace} from './workspace-storage';
import {mountScenarioApp} from './scenario-app';
import type {StoragePort} from './storage';
export {unmountApp} from './app-lifecycle';
export {mountScenarioApp} from './scenario-app';
/** Clock, UUID and browser storage access belong to startup, outside financial calculations. */
export function startBrowserApp(root:HTMLElement,storage?:StoragePort):ScenarioManager {
 const port=storage??{getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value)};
 let sequence=0;const nextId=()=>globalThis.crypto?.randomUUID?.()??`scenario-${Date.now()}-${++sequence}`;
 const loaded=loadWorkspace(port,nextId),today=new Date(),date=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
 const document=loaded.status==='loaded'||loaded.status==='migrated'?loaded.document:createScenarioWorkspace(createPlan(date,nextId()),nextId());
 const manager=createScenarioManager(document,port,loadRuleSet(),loaded.persistence,nextId);mountScenarioApp(root,manager);return manager;
}
