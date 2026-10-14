import { fireEvent,within } from '@testing-library/dom';
import {unmountApp} from '../../src/browser/main';
import type { PlanDocument } from '../../src/engine';
import { loadRuleSet } from '../../src/engine';
import type { StoragePort } from '../../src/browser/storage';

export function mountWorkspace(doc:PlanDocument,storage?:StoragePort){
  const {root,manager}=mountScenarioWorkspace(makeScenarioWorkspace(doc),storage);return {root,controller:manager.getActiveSession().controller,manager};
}
export function setField(root:HTMLElement,label:string,value:string):void {
  const control=[...root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')].find(node=>node.getAttribute('aria-label')===label)??within(root).getByLabelText(label) as HTMLInputElement|HTMLSelectElement;
  if(control instanceof HTMLSelectElement)fireEvent.change(control,{target:{value}});else fireEvent.input(control,{target:{value}});
}

import {createScenarioManager} from '../../src/browser/scenario-manager';
import {mountScenarioApp} from '../../src/browser/scenario-app';
import type {ScenarioWorkspaceDocument} from '../../src/browser/scenario-workspace';
import {exportWorkspace,WORKSPACE_STORAGE_KEY} from '../../src/browser/workspace-storage';
import {makeScenarioWorkspace,memoryWorkspaceStorage} from './scenarios';
export function mountScenarioWorkspace(doc:ScenarioWorkspaceDocument,storage?:StoragePort){
 for(const old of document.querySelectorAll<HTMLElement>('.workspace'))unmountApp(old);
 const root=document.createElement('main');document.body.replaceChildren(root);const raw=exportWorkspace(doc),port=storage??memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,raw]])).port;
 const manager=createScenarioManager(doc,port,loadRuleSet(),{persisted:true,persistenceIssues:[],suspension:'none',observedRaw:port.getItem(WORKSPACE_STORAGE_KEY)});mountScenarioApp(root,manager);return {root,manager};
}
