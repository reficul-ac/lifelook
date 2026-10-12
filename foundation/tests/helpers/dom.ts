import { fireEvent,within } from '@testing-library/dom';
import { mountApp } from '../../src/browser/main';
import type { PlanDocument } from '../../src/engine';
import { loadRuleSet } from '../../src/engine';
import type { StoragePort } from '../../src/browser/storage';

export function mountWorkspace(doc:PlanDocument,storage?:StoragePort){
  const memory=new Map<string,string>();const root=document.createElement('main');document.body.replaceChildren(root);
  const controller=mountApp(root,doc,storage??{getItem:key=>memory.get(key)??null,setItem:(key,value)=>{memory.set(key,value);}},loadRuleSet());
  return {root,controller};
}
export function setField(root:HTMLElement,label:string,value:string):void {
  const control=within(root).getByLabelText(label) as HTMLInputElement|HTMLSelectElement;
  if(control instanceof HTMLSelectElement)fireEvent.change(control,{target:{value}});else fireEvent.input(control,{target:{value}});
}
