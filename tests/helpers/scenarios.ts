import {createScenarioWorkspace,type ScenarioWorkspaceDocument} from '../../src/browser/scenario-workspace';
import type {PlanDocument} from '../../src/engine';
import type {StoragePort} from '../../src/browser/storage';
import {makePlan} from './plans';
export function makeScenarioWorkspace(plan:PlanDocument=makePlan(),overrides:Partial<ScenarioWorkspaceDocument>={}):ScenarioWorkspaceDocument{return {...createScenarioWorkspace(plan,'master'),...overrides};}
export function memoryWorkspaceStorage(initial:ReadonlyMap<string,string>=new Map()):{port:StoragePort;values:Map<string,string>;writes:()=>number}{
  const values=new Map(initial);let count=0;return {values,writes:()=>count,port:{getItem:key=>values.get(key)??null,setItem(key,value){count++;values.set(key,value);}}};
}
