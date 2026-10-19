import {element, refreshFields, setAt, type FieldContext} from './fields';
import {syncFormFeedback, registerFocusedForm} from './form-feedback';
import type {IssueViewContext} from './issue-presentation';
import type {RecordEditorMemory} from './record-ui-state';
import type {EditableSection, WorkspaceController} from './state';
import type {PrerequisiteRequest} from './prerequisite-flow';

export interface FormRenderOptions {
  section: EditableSection;
  recordId: string;
  memory: RecordEditorMemory;
  onSubmit(): void;
  requestPrerequisite?(request: PrerequisiteRequest): void;
}
export function renderRecordForm(root: HTMLElement, controller: WorkspaceController, section: EditableSection, recordId: string, title: string, renderFields: (root: HTMLElement, context: FieldContext) => void, ui?: IssueViewContext, options?: FormRenderOptions): HTMLFormElement {
  const form = element('form'); form.dataset.recordId = recordId; form.dataset.editableSection = section;
  if (options) {form.dataset.focusedForm = ''; registerFocusedForm(form, options.memory);}
  form.append(element('h3', options?String(controller.getDraft(section,recordId).value.name||title):title)); const body = element('div'); body.className = 'record-fields'; form.append(body); root.append(form);
  const context: FieldContext = {
    ...(ui ? {ui} : {}), ...(options ? {memory: options.memory, ...(options.requestPrerequisite ? {requestPrerequisite: options.requestPrerequisite} : {})} : {}),
    get draft() {return controller.getDraft(section, recordId);},
    get issues() {return controller.getState().issues;},
    onChange(path, value) {if(options&&!form.isConnected)return;const draft = controller.getDraft(section, recordId); controller.editDraft(recordId, {...draft, value: setAt(draft.value, path, value)});},
    refresh() {ui?.disclosures.closeWithin(body, false); refreshFields(body, () => renderFields(body, context)); if (ui) syncFormFeedback(root, controller, ui);},
  };
  context.refresh();
  form.addEventListener('focusout', event => {
    const field = (event.target as HTMLElement).dataset.field;
    if (options && field) {options.memory.touched.add(field); if (ui) syncFormFeedback(root, controller, ui);}
  });
  form.addEventListener('submit', event => {event.preventDefault();if(options&&!form.isConnected)return; if (options) {options.memory.attempted = true; options.onSubmit();} else controller.saveRecord(recordId);});
  return form;
}
