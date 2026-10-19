import {fireEvent, waitFor, within} from '@testing-library/dom';
import {editTargetKey} from '../../src/browser/record-ui-state';
import type {EditTarget} from '../../src/browser/edit-types';
import type {Destination} from '../../src/browser/workspace-route';
const destination = (target: EditTarget): Destination => target.kind === 'allocation' || target.section === 'accounts' || target.section === 'contributions' ? 'accounts' : target.section === 'salaries' || target.section === 'otherIncome' ? 'income' : target.section === 'properties' || target.section === 'rentals' ? 'properties' : target.section === 'household' ? 'household' : 'spending';
export function openCollection(root: HTMLElement, value: Destination): HTMLElement {
  const tab = root.querySelector<HTMLButtonElement>(`button[data-destination="${value}"]`); if (!tab) throw Error(`Missing destination ${value}`); fireEvent.click(tab); return root.querySelector<HTMLElement>('[data-collection]')!;
}
export function openRecord(root: HTMLElement, target: EditTarget): HTMLElement {
  const collection = openCollection(root, destination(target));
  const action = [...collection.querySelectorAll<HTMLButtonElement>('[data-open-target]')].find(node => node.dataset.openTarget === editTargetKey(target));
  if (!action) throw Error(`Missing record ${editTargetKey(target)}`); fireEvent.click(action); return root.querySelector<HTMLElement>('[data-active-editor]')!;
}
export async function waitForPreview(root: HTMLElement): Promise<void> {await waitFor(() => {if (root.querySelector('[data-preview-status]')?.getAttribute('data-preview-status') !== 'valid') throw Error('Preview not ready');}, {timeout: 10000});}
export async function switchScenario(root: HTMLElement, id: string): Promise<void> {fireEvent.change(within(root).getByLabelText('Scenario'), {target: {value: id}}); await waitFor(() => {if(root.querySelector('[data-active-editor]'))throw Error('Editor is still open');});}
export async function applyEdit(root: HTMLElement): Promise<void> {
  const editor=root.closest<HTMLElement>('[data-active-editor]')??root.querySelector<HTMLElement>('[data-active-editor]');
  if(!editor)throw Error('Open an editor before applying');
  const status=()=>editor.querySelector<HTMLElement>('[data-preview-status]')?.dataset.previewStatus;
  await waitFor(()=>{if(!status()||status()==='pending')throw Error('Waiting for current inputs');},{timeout:10000});
  if(status()==='inactive')return;
  const action=[...editor.querySelectorAll<HTMLButtonElement>('.editor-footer>button')].find(node=>/^Apply |^Review inputs$|^Retry calculation$/.test(node.textContent??''));
  if(!action)throw Error('Missing editor action');fireEvent.click(action);
  await waitFor(()=>{if(status()==='pending')throw Error('Waiting for reviewed inputs');},{timeout:10000});
}
export function openSettings(root: HTMLElement): HTMLElement {const panel=root.querySelector<HTMLElement>('[data-settings]')!;if(panel.hidden)fireEvent.click(within(root).getByRole('button',{name:'Settings'}));return panel;}
export function openForecastDetails(root: HTMLElement): HTMLElement {const summary=within(root).getByText('Forecast details',{selector:'summary'});const details=summary.parentElement as HTMLDetailsElement;if(!details.open)fireEvent.click(summary);return details;}
export function revealControl(root: HTMLElement,label: string): HTMLElement {let control=within(root).getByLabelText(label) as HTMLElement;const step=control.closest<HTMLElement>('[data-editor-step]')?.dataset.editorStep;if(step){const form=control.closest('form')??root;const tab=[...form.querySelectorAll<HTMLElement>('[data-select-editor-step]')].find(node=>node.dataset.selectEditorStep===step);if(tab)fireEvent.click(tab);control=within(root).getByLabelText(label) as HTMLElement;}const ancestors:HTMLDetailsElement[]=[];for(let parent=control.parentElement;parent&&root.contains(parent);parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)ancestors.unshift(parent);for(const details of ancestors)if(!details.open)fireEvent.click(details.querySelector(':scope > summary')!);return control;}
