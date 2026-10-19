import {revealField} from './form-feedback';
import type {ReviewTarget} from './issue-presentation';
export function reviewTarget(root:HTMLElement,target:ReviewTarget):boolean{
  const request={target,handled:false};root.dispatchEvent(new CustomEvent('financial-review',{detail:request,bubbles:true}));if(request.handled)return true;
  const section=[...root.querySelectorAll<HTMLElement>('[data-section]')].find(node=>node.dataset.section===target.section);
  if(!section)return false;
  section.hidden=false;
  const form=[...section.querySelectorAll<HTMLElement>('[data-record-id]')].find(node=>node.dataset.recordId===target.recordId);
  if(!form)return false;
  if(target.field&&revealField(form,target.field.split('.').map(p=>/^\d+$/.test(p)?Number(p):p)))return true;
  const focus=form.querySelector<HTMLElement>('h3,h2')??form;focus.tabIndex=-1;focus.focus();focus.scrollIntoView?.({block:'center'});return true;
}
