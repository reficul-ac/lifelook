import {fireEvent, waitFor, within} from '@testing-library/dom';
import {editTargetKey} from '../../src/browser/record-ui-state';
import type {FocusedEditTarget} from '../../src/browser/edit-types';
import type {Destination} from '../../src/browser/workspace-route';
const destination = (target: FocusedEditTarget): Destination => target.kind === 'allocation' || target.section === 'accounts' || target.section === 'contributions' ? 'accounts' : target.section === 'salaries' || target.section === 'otherIncome' ? 'income' : target.section === 'properties' || target.section === 'rentals' ? 'properties' : target.section === 'household' ? 'household' : 'spending';
export function openCollection(root: HTMLElement, value: Destination): HTMLElement {
  const tab = root.querySelector<HTMLButtonElement>(`button[data-destination="${value}"]`); if (!tab) throw Error(`Missing destination ${value}`); fireEvent.click(tab); return root.querySelector<HTMLElement>('[data-collection]')!;
}
export function openRecord(root: HTMLElement, target: FocusedEditTarget): HTMLElement {
  const collection = openCollection(root, destination(target));
  const action = [...collection.querySelectorAll<HTMLButtonElement>('[data-open-target]')].find(node => node.dataset.openTarget === editTargetKey(target));
  if (!action) throw Error(`Missing record ${editTargetKey(target)}`); fireEvent.click(action); return root.querySelector<HTMLElement>('[data-active-editor]')!;
}
export async function waitForPreview(root: HTMLElement): Promise<void> {await waitFor(() => {if (root.querySelector('[data-preview-status]')?.getAttribute('data-preview-status') !== 'valid') throw Error('Preview not ready');}, {timeout: 10000});}
export function beginScenarioSwitch(root: HTMLElement, id: string): void {fireEvent.click(within(root).getByLabelText('Scenario')); const action=[...within(root).getByRole('menu',{name:'Scenarios'}).querySelectorAll<HTMLButtonElement>('[data-scenario-action="switch"]')].find(node=>node.dataset.scenarioId===id);if(!action)throw Error(`Missing scenario ${id}`);fireEvent.click(action);}
export async function switchScenario(root: HTMLElement, id: string): Promise<void> {beginScenarioSwitch(root,id); await waitFor(() => {if((within(root).getByLabelText('Scenario') as HTMLButtonElement).value!==id||root.getAttribute('aria-busy')==='true')throw Error('Scenario is still switching');if(root.querySelector('[data-active-editor]'))throw Error('Editor is still open');});}
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
export function revealControl(root: HTMLElement,label: string): HTMLElement {
  // Keep label verification local: jsdom computes input.labels against every mounted label.
  const find=()=>{
    const candidates=[...root.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')].filter(node=>node.getAttribute('aria-label')===label);
    const scope=candidates.length===1?candidates[0]!.closest<HTMLElement>('[data-field-wrapper]')??candidates[0]!.parentElement??root:root;
    return within(scope).getByLabelText(label) as HTMLElement;
  };
  let control=find();
  const step=control.closest<HTMLElement>('[data-editor-step]')?.dataset.editorStep;
  if(step){
    const form=control.closest('form')??root;
    const tab=[...form.querySelectorAll<HTMLElement>('[data-select-editor-step]')].find(node=>node.dataset.selectEditorStep===step);
    if(tab)fireEvent.click(tab);
    control=find();
  }
  const ancestors:HTMLDetailsElement[]=[];
  for(let parent=control.parentElement;parent&&root.contains(parent);parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)ancestors.unshift(parent);
  for(const details of ancestors)if(!details.open)fireEvent.click(details.querySelector(':scope > summary')!);
  return control;
}
export function openRetirement(root:HTMLElement):HTMLElement {const tab=root.querySelector<HTMLButtonElement>('button[data-destination="retirement"]');if(!tab)throw Error('Missing Retirement destination');fireEvent.click(tab);const retirement=root.querySelector<HTMLElement>('[data-retirement-workspace]');if(!retirement)throw Error('Retirement workspace did not mount');return retirement;}
export async function applyRetirement(root:HTMLElement):Promise<void>{const retirement=root.closest<HTMLElement>('[data-retirement-workspace]')??root.querySelector<HTMLElement>('[data-retirement-workspace]');if(!retirement)throw Error('Open Retirement before applying');await waitFor(()=>{const action=within(retirement).getByRole<HTMLButtonElement>('button',{name:'Apply retirement changes'});if(action.disabled)throw Error('Waiting for the current retirement calculation');},{timeout:20000});fireEvent.click(within(retirement).getByRole('button',{name:'Apply retirement changes'}));await waitFor(()=>{if(!within(retirement).getByRole<HTMLButtonElement>('button',{name:'Apply retirement changes'}).disabled)throw Error('Retirement inputs are not yet applied');},{timeout:20000});}
