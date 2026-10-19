import {fireEvent,getByRole as rawGetByRole} from '@testing-library/dom';
import {setField as rawSetField} from './dom';
import {revealControl} from './workspace-ui';

export function setField(root:HTMLElement,label:string,value:string):void {revealControl(root,label);rawSetField(root,label,value);}
export function getByRole(root:HTMLElement,role:Parameters<typeof rawGetByRole>[1],options:Parameters<typeof rawGetByRole>[2]):HTMLElement {
 if(role==='button'&&typeof options?.name==='string'){
  const action=[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===options.name);
  if(action){const step=action.closest<HTMLElement>('[data-editor-step]')?.dataset.editorStep;if(step){const tab=[...(action.closest('form')??root).querySelectorAll<HTMLButtonElement>('[data-select-editor-step]')].find(node=>node.dataset.selectEditorStep===step);if(tab)fireEvent.click(tab);}const ancestors:HTMLDetailsElement[]=[];for(let parent=action.parentElement;parent&&root.contains(parent);parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)ancestors.unshift(parent);for(const detail of ancestors)if(!detail.open)fireEvent.click(detail.querySelector(':scope > summary')!);}
 }
 return rawGetByRole(root,role,options);
}
