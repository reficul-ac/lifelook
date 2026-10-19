import {button, element} from './fields';
import {syncFormFeedback, setFormTaskIssues} from './form-feedback';
import {createRecordEditorMemory, editTargetKey} from './record-ui-state';
import {revealEditorField} from './ui/editor-groups';
import type {FormRenderOptions} from './record-form';
import type {ScenarioEditorSession} from './scenario-session';
import type {EditTarget, EditPreviewCoordinator} from './edit-types';
import type {IssueViewContext} from './issue-presentation';
import {renderHouseholdForm} from './forms/household';
import {renderIncomeForm} from './forms/income';
import {renderInvestmentsForm} from './forms/investments';
import {renderExpensesDebtsForm} from './forms/expenses-debts';
import {renderPropertiesForm} from './forms/properties';
import {mountCashFlowAllocationEditor} from './forms/cash-flow-allocation';
import type {PrerequisiteRequest} from './prerequisite-flow';
import type {SaveRecordResult} from './state';
import {renderIssueDetails} from './views/issues';

export function mountFocusedEditor(root: HTMLElement, session: ScenarioEditorSession, target: EditTarget, context: IssueViewContext, coordinator: EditPreviewCoordinator, options?: {requestPrerequisite(request: PrerequisiteRequest): void; applied(target: EditTarget, result: SaveRecordResult): void; cancelPrerequisite?: () => void}): {reveal(field: string): boolean;restoreFocus():void; dispose(): void} {
  const controller = session.controller, key = editTargetKey(target);
  let memory = session.view.editorMemory.get(key);
  if (!memory) {memory = createRecordEditorMemory(); session.view.editorMemory.set(key, memory);}
  const editorMemory = memory;
  let disposed=false;
  const isCurrent=()=>!disposed&&root.isConnected&&coordinator.getState().target!==null&&editTargetKey(coordinator.getState().target!)===key;
  const requestPrerequisite=options?((request:PrerequisiteRequest)=>{if(isCurrent())options.requestPrerequisite(request);}):undefined;
  root.replaceChildren(); root.dataset.editTarget = key;
  const content = element('div'); content.className = 'focused-editor-content'; root.append(content);
  let allocation: {dispose(): void} | undefined;
  const removeFeedback=element('div');removeFeedback.dataset.operationFeedback='';
  const applyLabel = target.kind === 'allocation' ? 'Apply allocation' : ({salaries: 'Apply salary changes', accounts: 'Apply account', contributions: 'Apply contribution', household: 'Apply household changes', properties: 'Apply property changes'} as Partial<Record<string, string>>)[target.section] ?? 'Apply changes';
  const attempt = () => {
    if(!isCurrent())return;
    editorMemory.attempted = true;
    const state = coordinator.getState();
    if (state.status === 'valid' && state.current) {
      const result = coordinator.apply();
      if (result.accepted) {editorMemory.modes.clear(); editorMemory.touched.clear(); editorMemory.attempted = false; announcement.textContent = result.persisted ? 'Changes applied.' : 'Applied · Not saved locally';}
      options?.applied(target, result);
    } else if (state.status === 'invalid' || state.status === 'stale') {update(); revealFirstIssue(); return;}
    else coordinator.request(true);
    update();
  };
  if (target.kind === 'allocation') {
    allocation = mountCashFlowAllocationEditor(content, controller, context, {view: session.view, preview: coordinator, ...(requestPrerequisite ? {requestPrerequisite} : {})});
    for (const action of content.querySelectorAll<HTMLButtonElement>('button')) if (action.textContent === 'Apply allocation' || action.textContent === 'Discard allocation edits') action.hidden = true;
  } else {
    const formOptions: FormRenderOptions = {section: target.section, recordId: target.recordId, memory: editorMemory, onSubmit: attempt, ...(requestPrerequisite ? {requestPrerequisite} : {})};
    const renderer = target.section === 'household' ? renderHouseholdForm : target.section === 'salaries' || target.section === 'otherIncome' ? renderIncomeForm : target.section === 'accounts' || target.section === 'contributions' ? renderInvestmentsForm : target.section === 'properties' || target.section === 'rentals' ? renderPropertiesForm : renderExpensesDebtsForm;
    renderer(content, controller, context, formOptions);
  }
  const footer = element('div'); footer.className = 'editor-footer';
  const status = element('p'); status.dataset.previewStatus = '';
  const apply = button(applyLabel, attempt); apply.className = 'primary-action';
  const discard = button('Discard edits', () => {if(!isCurrent())return;editorMemory.modes.clear(); editorMemory.touched.clear(); editorMemory.attempted = false; coordinator.discard(); root.dispatchEvent(new CustomEvent('editor-discarded', {bubbles: true, detail: target}));}); discard.className='secondary';
  const announcement = element('p'); announcement.setAttribute('role', 'status'); announcement.className = 'editor-announcement';
  footer.append(status, apply, discard, element('small', 'Unapplied edits stay in this tab. Reload and backups keep applied inputs only.'), announcement);
  if (target.kind === 'record' && target.section !== 'household') {
    const saved = (controller.getState().savedPlan[target.section] ?? []).some(record => record.id === target.recordId);
    if (saved) {const remove=button('Remove record', () => {if(!isCurrent())return;const result = controller.removeRecord(target.section, target.recordId); if (result.accepted) root.dispatchEvent(new CustomEvent('editor-removed', {bubbles: true})); else {const form = content.querySelector<HTMLElement>('form'); if (form) {setFormTaskIssues(form, result.issues, session.view); editorMemory.attempted = true; syncFormFeedback(content, controller, context);}}});remove.className='destructive';footer.append(remove);}
  }
  root.append(footer);
  if (options?.cancelPrerequisite) footer.append(button('Cancel and return',()=>{if(isCurrent())options.cancelPrerequisite!();}));
  const followThrough = target.kind === 'record' && target.section === 'accounts' ? button('Add contributions', () => {if(isCurrent())root.dispatchEvent(new CustomEvent('editor-add-contribution', {bubbles: true, detail: target.recordId}));}) : undefined;
  if (followThrough) footer.append(followThrough);
  if(target.kind==='record')content.querySelector('form')?.append(removeFeedback);
  let shownRemove:readonly import('../engine').Issue[]|undefined;
  const reveal = (field: string) => revealEditorField(root, field.split('.').map(part => /^\d+$/.test(part) ? Number(part) : part), editorMemory);
  const revealFirstIssue = () => {const issue = coordinator.getState().issues.find(item => item.field); if (issue?.field) reveal(issue.field);};
  const update = () => {
    const state = coordinator.getState(); status.dataset.previewStatus = state.status;
    const labels = {inactive: 'Applied results · no changes', pending: 'Updating preview…', valid: 'Preview · changes not applied', invalid: 'Preview paused · review inputs', stale: 'Preview paused · newer inputs changed this record', failed: 'Preview unavailable · retry calculation'};
    const previous = status.textContent; if (previous !== labels[state.status]) status.textContent = labels[state.status];
    apply.textContent = state.status === 'invalid' || state.status === 'stale' ? 'Review inputs' : state.status === 'failed' ? 'Retry calculation' : state.status === 'pending' ? 'Updating…' : applyLabel;
    apply.disabled = state.status === 'inactive' || state.status === 'pending';
    if (followThrough && target.kind === 'record') followThrough.hidden = !controller.getState().savedPlan.accounts.some(account => account.id === target.recordId && account.type !== 'rsu');
    const form = content.querySelector<HTMLElement>('form[data-record-id]');
    if (form) {setFormTaskIssues(form, state.issues, session.view); syncFormFeedback(content, controller, context);}
    const removeIssues=target.kind==='record'?session.view.removeIssues.get(target.recordId):undefined;
    if(removeIssues!==shownRemove){shownRemove=removeIssues;context.disclosures.closeWithin(removeFeedback,false);removeFeedback.replaceChildren();if(removeIssues?.length){removeFeedback.append(element('strong','Record not removed. Resolve its linked inputs, then remove again.'));renderIssueDetails(removeFeedback,removeIssues.map(issue=>({issue})),context);}}
  };
  const unsubscribe = coordinator.subscribe(update);
  const unsubscribeRemove=controller.subscribe(operation=>{if(operation?.kind==='remove')update();});
  const commit = () => {if(isCurrent())coordinator.request(true);}; root.addEventListener('financial-input-commit', commit);
  const focusout = (event: FocusEvent) => {const control = event.target; if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {const field = control.dataset.field; if (field) editorMemory.focus = {field, start: control instanceof HTMLInputElement && control.type === 'text' ? control.selectionStart : null, end: control instanceof HTMLInputElement && control.type === 'text' ? control.selectionEnd : null};}};
  content.addEventListener('focusout', focusout); content.scrollTop = editorMemory.scrollTop;
  update();
  return {reveal, restoreFocus(){const saved=editorMemory.focus;if(!saved)return;const control=[...content.querySelectorAll<HTMLElement>('[data-field]')].find(node=>node.dataset.field===saved.field);control?.focus();if(control instanceof HTMLInputElement&&control.type==='text')control.setSelectionRange(saved.start,saved.end);}, dispose() {if(disposed)return;disposed=true;editorMemory.scrollTop = content.scrollTop; unsubscribe();unsubscribeRemove(); allocation?.dispose(); root.removeEventListener('financial-input-commit', commit); content.removeEventListener('focusout', focusout); context.disclosures.closeWithin(root, false);}};
}
