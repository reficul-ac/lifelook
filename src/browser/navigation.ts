import type {ReviewTarget} from './issue-presentation';
export function reviewTarget(root:HTMLElement,target:ReviewTarget):boolean{
  const section=[...root.querySelectorAll<HTMLElement>('[data-section]')].find(node=>node.dataset.section===target.section);
  if(!section)return false;
  const tab=[...root.querySelectorAll<HTMLButtonElement>('nav button')].find(node=>node.textContent===target.section);tab?.click();
  const form=[...section.querySelectorAll<HTMLElement>('[data-record-id]')].find(node=>node.dataset.recordId===target.recordId);
  if(!form)return false;
  const field=target.field?[...form.querySelectorAll<HTMLElement>('[data-field]')].find(node=>node.dataset.field===target.field||node.dataset.field===`${target.field}.known`):undefined;
  const focus=field??form.querySelector<HTMLElement>('h3,h2')??form;
  for(let parent=focus.parentElement;parent&&form.contains(parent);parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
  if(!field)focus.tabIndex=-1;focus.focus();focus.scrollIntoView?.({block:'center'});return true;
}
