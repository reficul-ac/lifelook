import { CHILD_PLANNING_MODEL_VERSION, childCostBands } from '../../engine';
import { element, renderField, renderRecordSection } from '../fields';
import type { IssueViewContext } from '../issue-presentation';
import type { WorkspaceController } from '../state';

const annualMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function renderChildPlanningForm(root: HTMLElement, controller: WorkspaceController, ui?: IssueViewContext): void {
  root.replaceChildren();
  root.append(element('h2', 'Child planning'));
  root.append(element('p', 'User-supplied Oceanside planning budget in today’s dollars. Each annual age budget is divided by 12, with no inflation. Ages 0–17 total $194,000 per child; including age 18 totals $210,000.'));
  root.append(element('p', 'Excludes housing, medical costs, education and day care. Enter those separately as needed. Child planning does not model tax dependents or child tax credits.'));
  const reference = element('details');
  reference.append(element('summary', 'Age-based budgets'));
  const table = element('table');
  table.append(element('caption', 'Child annual budgets'));
  const head = element('thead'), headings = element('tr');
  for (const label of ['Age', 'Annual budget']) {
    const cell = element('th', label); cell.scope = 'col'; headings.append(cell);
  }
  head.append(headings); table.append(head);
  const body = element('tbody');
  for (const band of childCostBands) {
    const row = element('tr'), label = element('th', band.label); label.scope = 'row';
    row.append(label, element('td', annualMoney.format(band.annualCents / 100))); body.append(row);
  }
  table.append(body);
  reference.append(table, element('small', `Planning model: ${CHILD_PLANNING_MODEL_VERSION}. Cent rounding preserves each full age-year budget.`));
  root.append(reference);
  const records = element('section'); root.append(records);
  renderRecordSection(records, controller, 'children', 'Child', (body, context) => {
    renderField(body, context, ['name'], 'Child name', { visibleLabel: 'Name' });
    renderField(body, context, ['birthMonth'], 'Child birth month', { kind: 'month', visibleLabel: 'Birth month', hint: 'Costs begin in the birth month and change age bands in that month each year.' });
    renderField(body, context, ['includeAge18'], 'Include full year at age 18', { kind: 'checkbox', hint: 'Default: stop at the 18th birthday month. Selected: include all 12 months at age 18 and stop at the 19th birthday month.' });
  }, undefined, ui, '');
}
