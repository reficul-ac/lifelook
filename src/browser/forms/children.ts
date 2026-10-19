import type {FormRenderOptions} from '../record-form';
import {CHILD_PLANNING_MODEL_VERSION, childCostBands} from '../../engine';
import {element, renderField, renderRecordSection, type FieldContext} from '../fields';
import {fieldMemory} from '../record-ui-state';
import {renderEditorGroup} from '../ui/editor-groups';
import type {IssueViewContext} from '../issue-presentation';
import type {WorkspaceController} from '../state';

const annualMoney = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
function renderBudgetModel(root: HTMLElement): void {
  root.append(element('p', 'User-supplied Oceanside planning budget in today’s dollars. Each annual age budget is divided by 12, with no inflation. Ages 0–17 total $194,000 per child; including age 18 totals $210,000.'));
  const table = element('table'); table.append(element('caption', 'Child annual budgets'));
  const head = element('thead'), headings = element('tr');
  for (const label of ['Age', 'Annual budget']) {const cell = element('th', label); cell.scope = 'col'; headings.append(cell);}
  head.append(headings); table.append(head);
  const body = element('tbody');
  for (const band of childCostBands) {const row = element('tr'), label = element('th', band.label); label.scope = 'row'; row.append(label, element('td', annualMoney.format(band.annualCents / 100))); body.append(row);}
  table.append(body); root.append(table, element('small', `Planning model: ${CHILD_PLANNING_MODEL_VERSION}. Cent rounding preserves each full age-year budget.`));
}
const exclusions = 'Excludes housing, medical costs, education and day care. Enter those separately as needed. Child planning does not model tax dependents or child tax credits.';

export function renderChildFields(root: HTMLElement, _controller: WorkspaceController, context: FieldContext): void {
  const memory = fieldMemory(context);
  renderEditorGroup(root, {id: 'child-basics', label: 'Child budget', advanced: false}, memory, body => {
    renderField(body, context, ['name'], 'Child name', {visibleLabel: 'Name'});
    renderField(body, context, ['birthMonth'], 'Child birth month', {kind: 'month', visibleLabel: 'Birth month', hint: 'Costs begin in the birth month and change age bands in that month each year.'});
    renderField(body, context, ['includeAge18'], 'Include full year at age 18', {kind: 'checkbox', hint: 'Default: stop at the 18th birthday month. Selected: include all 12 months at age 18 and stop at the 19th birthday month.'});
    body.append(element('small', exclusions));
  });
  if (context.memory) renderEditorGroup(root, {id: 'child-budget-model', label: 'Age-based budgets', advanced: true}, memory, renderBudgetModel);
}

export function renderChildPlanningForm(root: HTMLElement, controller: WorkspaceController, ui?: IssueViewContext, options?: FormRenderOptions): void {
  root.replaceChildren();
  if (!options) {
    root.append(element('h2', 'Child planning'), element('p', exclusions));
    const reference = element('details'); reference.append(element('summary', 'Age-based budgets')); renderBudgetModel(reference); root.append(reference);
  }
  const records = element('section'); root.append(records);
  renderRecordSection(records, controller, 'children', 'Child', (body, context) => renderChildFields(body, controller, context), undefined, ui, '', options);
}
