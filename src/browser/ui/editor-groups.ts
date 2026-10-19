import {element, type FieldPath} from '../fields';
import type {RecordEditorMemory} from '../record-ui-state';

export function renderEditorGroup(root: HTMLElement, options: {id: string; label: string; advanced: boolean; step?: string; summary?: () => string}, memory: RecordEditorMemory, render: (body: HTMLElement) => void): HTMLElement {
  const group = options.advanced ? element('details') : element('section');
  group.dataset.editorGroup = options.id;
  if (options.step) {group.dataset.editorStep = options.step; group.hidden = memory.step !== options.step;}
  const label = options.label + (options.summary?.() ? ` · ${options.summary()}` : '');
  group.append(element(options.advanced ? 'summary' : 'h3', label));
  if (group instanceof HTMLDetailsElement) {
    group.open = memory.openGroups.has(options.id);
    group.addEventListener('toggle', () => {if (group.open) memory.openGroups.add(options.id); else memory.openGroups.delete(options.id);});
  }
  const body = element('div'); group.append(body); render(body); root.append(group); return group;
}
export function revealEditorField(root: HTMLElement, path: FieldPath, memory: RecordEditorMemory): boolean {
  const key = path.join('.');
  const fields=[...root.querySelectorAll<HTMLElement>('[data-field]')];
  const target=fields.find(node=>node.dataset.field===key)??fields.find(node=>node.dataset.field===`${key}.known`||node.dataset.field===`${key}.value`)??[...root.querySelectorAll<HTMLElement>('[data-field-group]')].find(node=>node.dataset.fieldGroup===key);
  if (!target) return false;
  const selectedStep=target.closest<HTMLElement>('[data-editor-step]')?.dataset.editorStep;
  if(selectedStep)[...root.querySelectorAll<HTMLButtonElement>('[data-select-editor-step]')].find(action=>action.dataset.selectEditorStep===selectedStep)?.click();
  for (let node: HTMLElement | null = target; node && root.contains(node); node = node.parentElement) {
    if (node.dataset.editorStep) memory.step = node.dataset.editorStep;
    if (node instanceof HTMLDetailsElement) {node.open = true; if (node.dataset.editorGroup) memory.openGroups.add(node.dataset.editorGroup);}
    node.hidden = false;
  }
  for (const step of root.querySelectorAll<HTMLElement>('[data-editor-step]')) step.hidden = step.dataset.editorStep !== memory.step;
  if (!target.matches('input,select,textarea,button')) target.tabIndex = -1;
  target.focus(); target.scrollIntoView?.({block: 'nearest'}); return true;
}
