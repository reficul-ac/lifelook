import {element, renderField, renderRows, valueAt, type FieldContext} from '../fields';
import {parseMoneyInput, parseRateInput} from '../input-parsers';
import {fieldMemory, swapMode} from '../record-ui-state';
import {renderEditorGroup} from '../ui/editor-groups';
import {mountAnniversaryControl} from '../ui/anniversary-control';
import {formatCents} from '../views/issues';
import type {RawObject, WorkspaceController} from '../state';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
let changeSequence = 0;

/** Salary names make existing employer identities recognizable without inventing employer records. */
export function renderEmployerField(root: HTMLElement, controller: WorkspaceController, context: FieldContext, label: string): void {
  const control = renderField(root, context, ['employerId'], label, {hint: 'Use the same employer for salary-linked contributions and catch-up facts.'});
  const list = element('datalist'); list.id = `${control.id}-employers`; control.setAttribute('list', list.id);
  const employers = new Map(controller.getState().savedPlan.salaries.map(salary => [salary.employerId, salary.name]));
  const current = context.draft.value.employerId;
  if (typeof current === 'string' && current && !employers.has(current)) employers.set(current, String(context.draft.value.name ?? 'Current income'));
  for (const [id, name] of employers) {const option = element('option'); option.value = id; option.label = `${name} · ${id}`; list.append(option);}
  root.append(list);
}

function growthSummary(context: FieldContext): string {
  const raw = context.draft.value;
  const rate = parseRateInput(String(raw.annualRaiseBps ?? ''));
  const anniversary = `${months[Number(raw.raiseMonth) - 1] ?? 'month needed'} ${raw.raiseDay ?? 'day needed'}`;
  const parts = [rate.status === 'available' ? `${rate.value / 100}% each ${anniversary}` : 'Annual raise needs input'];
  if (raw.annualRaiseCapCents !== undefined) {const cap = parseMoneyInput(String(raw.annualRaiseCapCents)); parts.push(cap.status === 'available' ? `cap ${formatCents(cap.value)}` : 'Cap needs input');}
  const count = Array.isArray(raw.changes) ? raw.changes.length : 0;
  if (count) parts.push(`${count} dated change${count === 1 ? '' : 's'}`);
  if (raw.endDate) parts.push(`ends ${String(raw.endDate)}`);
  return parts.join(' · ');
}

export function renderSalaryFields(root: HTMLElement, controller: WorkspaceController, context: FieldContext): void {
  const memory = fieldMemory(context);
  renderEditorGroup(root, {id: 'salary-basics', label: 'Salary basics', advanced: false}, memory, body => {
    renderField(body, context, ['name'], 'Salary name');
    renderField(body, context, ['ownerId'], 'Salary owner', {kind: 'select', options: controller.getState().savedPlan.household.filers.map(filer => ({value: filer.id, label: filer.name}))});
    renderEmployerField(body, controller, context, 'Salary employer');
    renderField(body, context, ['annualGrossCents'], 'Annual gross salary ($)', {kind: 'money'});
    renderField(body, context, ['startDate'], 'Salary start date', {kind: 'date'});
  });
  const group = renderEditorGroup(root, {id: 'salary-growth', label: 'Growth and changes', advanced: !!context.memory, summary: () => growthSummary(context)}, memory, body => {
    renderField(body, context, ['annualRaiseBps'], 'Annual salary raise (%)', {kind: 'rate', slider: {minUnits: -2000, maxUnits: 2000, stepUnits: 25}});
    const anniversary = element('div'); body.append(anniversary);
    mountAnniversaryControl(anniversary, {month: String(context.draft.value.raiseMonth ?? ''), day: String(context.draft.value.raiseDay ?? ''), onChange(month, day) {
      context.onChange(['raiseMonth'], month); context.onChange(['raiseDay'], day);
    }});
    for (const control of anniversary.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')) {
      const label = control.dataset.field === 'raiseMonth' ? 'Salary raise month' : 'Salary raise day';
      control.setAttribute('aria-label', label); control.dataset.fieldLabel = label;
      if (control.hasAttribute('aria-describedby')) control.dataset.hintIds = control.getAttribute('aria-describedby')!;
      const wrapper = control.parentElement!; wrapper.dataset.fieldWrapper = ''; wrapper.classList.add('field-wrapper');
      const error = element('small'); error.id = `${control.id}-error`; error.dataset.fieldError = control.dataset.field; error.className = 'field-error'; wrapper.append(error);
    }
    renderField(body, context, ['annualRaiseCapCents'], 'Automatic salary raise cap ($)', {kind: 'money', optional: true, hint: 'Annual gross salary ceiling for automatic raises only. Blank means unlimited. Must be at least the initial annual gross salary; dated salary changes may exceed it.'});
    renderField(body, context, ['endDate'], 'Salary end date', {kind: 'date', optional: true, hint: 'Includes this date. Blank means no end.'});
    renderRows(body, context, ['changes'], 'salary change', () => ({date: '', kind: 'percent', percentBps: ''}), (row, path, index) => {
      renderField(row, context, [...path, 'date'], `Salary change date ${index + 1}`, {kind: 'date'});
      const choice: FieldContext = {...context, get draft() {return context.draft;}, onChange(_path, value) {
        const current = valueAt(context.draft.value, path) as RawObject;
        const metadata: RawObject = current.__draft && typeof current.__draft === 'object' && !Array.isArray(current.__draft) ? current.__draft as RawObject : {};
        const key = typeof metadata.salaryChangeKey === 'string' ? metadata.salaryChangeKey : `salary-change-${++changeSequence}`;
        const active = current.kind === 'percent' ? {percentBps: current.percentBps} : {annualGrossCents: current.annualGrossCents};
        const fallback = value === 'percent' ? {percentBps: ''} : {annualGrossCents: ''};
        const restored = swapMode(memory, key, String(current.kind), String(value), active, fallback);
        context.onChange(path, {date: current.date, kind: value, ...restored, __draft: {...metadata, salaryChangeKey: key}});
      }};
      renderField(row, choice, [...path, 'kind'], `Salary change type ${index + 1}`, {kind: 'select', options: [{value: 'percent', label: 'Percentage raise'}, {value: 'amount', label: 'Set annual salary'}], refresh: true});
      const current = valueAt(context.draft.value, path) as RawObject;
      if (current.kind === 'percent') renderField(row, context, [...path, 'percentBps'], `Salary change percentage ${index + 1} (%)`, {kind: 'rate'});
      else renderField(row, context, [...path, 'annualGrossCents'], `Salary change annual amount ${index + 1} ($)`, {kind: 'money'});
    });
  });
  const updateSummary = () => {const heading = group.querySelector('summary,h3'); if (heading) heading.textContent = `Growth and changes · ${growthSummary(context)}`;};
  group.addEventListener('input', updateSummary); group.addEventListener('change', updateSummary);
}
