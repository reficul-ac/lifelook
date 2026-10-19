import type {FormRenderOptions} from '../record-form';
import type {IssueViewContext} from '../issue-presentation';
import {renderField, renderRecordSection, type FieldContext} from '../fields';
import {fieldMemory, swapMode} from '../record-ui-state';
import {renderEditorGroup} from '../ui/editor-groups';
import {parseRateInput} from '../input-parsers';
import type {RawObject, WorkspaceController} from '../state';
import {renderEmployerField, renderSalaryFields} from './salary-fields';

export function renderOtherIncomeFields(root: HTMLElement, controller: WorkspaceController, context: FieldContext): void {
  const memory = fieldMemory(context);
  const owners = controller.getState().savedPlan.household.filers.map(filer => ({value: filer.id, label: filer.name}));
  renderEditorGroup(root, {id: 'income-basics', label: 'Income basics', advanced: false}, memory, body => {
    renderField(body, context, ['name'], 'Income name');
    renderField(body, context, ['amountCents'], 'Income amount ($)', {kind: 'money'});
    renderField(body, context, ['frequency'], 'Income frequency', {kind: 'select', options: ['monthly', 'annual']});
    renderField(body, context, ['startDate'], 'Income start date', {kind: 'date', hint: 'Payments repeat on this date each month or year.'});
    const choice: FieldContext = {...context, get draft() {return context.draft;}, onChange(_path, value) {
      const raw = context.draft.value;
      const active: RawObject = Object.fromEntries(['ownerId', 'employerId', 'niitTreatment'].filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
      const fallback: RawObject = value === 'wage' ? {ownerId: owners[0]?.value ?? '', employerId: ''} : value === 'ordinary-taxable' ? {niitTreatment: 'unknown'} : {};
      const restored = swapMode(memory, 'income-classification', String(raw.classification), String(value), active, fallback);
      const common = {...raw}; delete common.ownerId; delete common.employerId; delete common.niitTreatment;
      context.onChange([], {...common, classification: value, ...restored});
    }};
    renderField(body, choice, ['classification'], 'Income classification', {kind: 'select', options: [{value: 'wage', label: 'Wage income'}, {value: 'ordinary-taxable', label: 'Ordinary taxable income'}, {value: 'non-taxable', label: 'Non-taxable cash'}], refresh: true});
    if (context.draft.value.classification === 'wage') {
      renderField(body, context, ['ownerId'], 'Income owner', {kind: 'select', options: owners});
      renderEmployerField(body, controller, context, 'Income employer');
    } else if (context.draft.value.classification === 'ordinary-taxable') {
      renderField(body, context, ['niitTreatment'], 'Income NIIT treatment', {kind: 'select', options: [{value: 'unknown', label: 'Unknown'}, {value: 'included', label: 'Included: interest or ordinary dividends'}, {value: 'excluded', label: 'Excluded'}], hint: 'Qualified dividends and realized capital gains are unsupported.', help: 'Net Investment Income Tax (NIIT) applies to eligible investment income; wages are excluded.'});
    }
  });
  const summary = () => {
    const rate = parseRateInput(String(context.draft.value.annualGrowthBps ?? ''));
    return [rate.status === 'available' ? `${rate.value / 100}% annual growth` : 'Growth needs input', ...(context.draft.value.endDate ? [`ends ${String(context.draft.value.endDate)}`] : [])].join(' · ');
  };
  const growth = renderEditorGroup(root, {id: 'income-growth', label: 'Growth and dates', advanced: !!context.memory, summary}, memory, body => {
    renderField(body, context, ['annualGrowthBps'], 'Income annual growth (%)', {kind: 'rate', slider: {minUnits: -2000, maxUnits: 2000, stepUnits: 25}});
    renderField(body, context, ['endDate'], 'Income end date', {kind: 'date', optional: true, hint: 'Includes this date. Blank means no end.'});
  });
  const updateSummary = () => {const heading = growth.querySelector('summary,h3'); if (heading) heading.textContent = `Growth and dates · ${summary()}`;};
  growth.addEventListener('input', updateSummary); growth.addEventListener('change', updateSummary);
}

export function renderIncomeForm(root: HTMLElement, controller: WorkspaceController, ui?: IssueViewContext, options?: FormRenderOptions): void {
  root.replaceChildren();
  const salaries = document.createElement('section'), other = document.createElement('section'); root.append(salaries, other);
  renderRecordSection(salaries, controller, 'salaries', 'Salary', (body, context) => renderSalaryFields(body, controller, context), undefined, ui, undefined, options);
  renderRecordSection(other, controller, 'otherIncome', 'Other income', (body, context) => renderOtherIncomeFields(body, controller, context), undefined, ui, undefined, options);
}
