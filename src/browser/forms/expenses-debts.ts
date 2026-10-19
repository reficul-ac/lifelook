import type {FormRenderOptions} from '../record-form';
import {getRecordLabel, type IssueViewContext} from '../issue-presentation';
import {element, taxCategoryOptions, renderField, renderHistory, renderRecordSection, type FieldContext} from '../fields';
import {fieldMemory, swapMode} from '../record-ui-state';
import {renderEditorGroup} from '../ui/editor-groups';
import {parseRateInput} from '../input-parsers';
import type {RawObject, WorkspaceController} from '../state';
import {renderChildPlanningForm} from './children';

const mortgageNote = 'Mortgage payments already enter the forecast from Properties. Add each mortgage once, under its property.';

export function renderExpenseFields(root: HTMLElement, controller: WorkspaceController, context: FieldContext): void {
  const plan = controller.getState().savedPlan, memory = fieldMemory(context);
  renderEditorGroup(root, {id: 'expense-basics', label: 'Spending basics', advanced: false}, memory, body => {
    renderField(body, context, ['name'], 'Expense name');
    renderField(body, context, ['amountCents'], 'Expense amount ($)', {kind: 'money'});
    renderField(body, context, ['frequency'], 'Expense frequency', {kind: 'select', options: ['monthly', 'annual'], hint: 'Annual amounts are divided by 12 and budgeted monthly.'});
    renderField(body, context, ['startDate'], 'Expense start date', {kind: 'date', hint: 'Monthly budgets begin on this date; no daily proration. Shorter months use their last day.'});
    if (plan.properties.some(property => property.loans.length)) body.append(element('small', mortgageNote));
  });
  const growthSummary = () => {
    const rate = parseRateInput(String(context.draft.value.annualGrowthBps ?? ''));
    return [rate.status === 'available' ? `${rate.value / 100}% annual growth` : 'Growth needs input', ...(context.draft.value.endDate ? [`ends ${String(context.draft.value.endDate)}`] : [])].join(' · ');
  };
  const growth = renderEditorGroup(root, {id: 'expense-growth', label: 'Growth and dates', advanced: !!context.memory, summary: growthSummary}, memory, body => {
    renderField(body, context, ['annualGrowthBps'], 'Expense annual growth (%)', {kind: 'rate', slider: {minUnits: -2000, maxUnits: 2000, stepUnits: 25}});
    renderField(body, context, ['endDate'], 'Expense end date', {kind: 'date', optional: true, hint: 'Includes this date. Blank means no end.'});
  });
  const updateGrowth = () => {const heading = growth.querySelector('summary,h3'); if (heading) heading.textContent = `Growth and dates · ${growthSummary()}`;};
  growth.addEventListener('input', updateGrowth); growth.addEventListener('change', updateGrowth);
  const taxSummary = () => [String(context.draft.value.use), String(context.draft.value.taxCategory), ...(context.draft.value.propertyId ? [getRecordLabel(plan, String(context.draft.value.propertyId))] : []), ...(context.draft.value.rentalId ? [getRecordLabel(plan, String(context.draft.value.rentalId))] : [])].join(' · ');
  const tax = renderEditorGroup(root, {id: 'expense-tax', label: 'Property and tax treatment', advanced: !!context.memory, summary: taxSummary}, memory, body => {
    const properties = [{value: '', label: 'None'}, ...plan.properties.map(property => ({value: property.id, label: property.name}))];
    renderField(body, context, ['propertyId'], 'Expense property', {kind: 'select', options: properties, optional: true, refresh: true});
    const selectedRental = plan.rentals.find(rental => rental.id === context.draft.value.rentalId);
    const rentals = [{value: '', label: 'None'}, ...plan.rentals.filter(rental => !context.draft.value.propertyId || rental.propertyId === context.draft.value.propertyId || rental === selectedRental).map(rental => ({value: rental.id, label: getRecordLabel(plan, rental.id)}))];
    renderField(body, context, ['rentalId'], 'Expense rental unit', {kind: 'select', options: rentals, optional: true});
    const useContext: FieldContext = {...context, get draft() {return context.draft;}, onChange(_path, value) {
      const raw = context.draft.value;
      const restored = swapMode(memory, 'expense-use', String(raw.use), String(value), raw.allocationOverride === undefined ? {} : {allocationOverride: raw.allocationOverride}, {});
      const next: RawObject = {...raw, use: value}; delete next.allocationOverride;
      context.onChange([], {...next, ...restored});
    }};
    renderField(body, useContext, ['use'], 'Expense use', {kind: 'select', options: ['personal', 'rental', 'shared'], refresh: true});
    const taxContext: FieldContext = {...context, get draft() {return context.draft;}, onChange(_path, value) {
      const raw = context.draft.value;
      const restored = swapMode(memory, 'expense-tax-category', String(raw.taxCategory), String(value), raw.mortgageInsuranceQualification === undefined ? {} : {mortgageInsuranceQualification: raw.mortgageInsuranceQualification}, {});
      const next: RawObject = {...raw, taxCategory: value}; delete next.mortgageInsuranceQualification;
      context.onChange([], {...next, ...restored});
    }};
    renderField(body, taxContext, ['taxCategory'], 'Expense tax category', {kind: 'select', options: taxCategoryOptions, refresh: true});
    if (context.draft.value.use === 'shared') {
      const toggle: FieldContext = {...context, get draft() {return {...context.draft, value: {...context.draft.value, override: !!context.draft.value.allocationOverride}};}, onChange(_path, value) {
        const current = context.draft.value.allocationOverride;
        const restored = swapMode(memory, 'expense-allocation-override', current ? 'on' : 'off', value ? 'on' : 'off', current ? {allocationOverride: current} : {}, value ? {allocationOverride: {numerator: '', denominator: ''}} : {});
        context.onChange(['allocationOverride'], restored.allocationOverride);
      }};
      renderField(body, toggle, ['override'], 'Override shared expense allocation', {kind: 'checkbox', refresh: true});
      if (context.draft.value.allocationOverride) {
        renderField(body, context, ['allocationOverride', 'numerator'], 'Expense allocation Rental portion', {kind: 'integer', visibleLabel: 'Rental portion'});
        renderField(body, context, ['allocationOverride', 'denominator'], 'Expense allocation Total portions', {kind: 'integer', visibleLabel: 'Total portions', hint: '1 of 4 = 25%.'});
      }
    }
    if (context.draft.value.taxCategory === 'mortgage-insurance') renderHistory(body, context, ['mortgageInsuranceQualification'], 'Qualified mortgage insurance premiums', {kind: 'checkbox'});
  });
  const updateTax = () => {const heading = tax.querySelector('summary,h3'); if (heading) heading.textContent = `Property and tax treatment · ${taxSummary()}`;};
  tax.addEventListener('input', updateTax); tax.addEventListener('change', updateTax);
}

export function renderDebtFields(root: HTMLElement, controller: WorkspaceController, context: FieldContext): void {
  const memory = fieldMemory(context), plan = controller.getState().savedPlan;
  renderEditorGroup(root, {id: 'debt-basics', label: 'Debt basics', advanced: false}, memory, body => {
    body.append(element('small', mortgageNote));
    renderField(body, context, ['name'], 'Debt name');
    renderField(body, context, ['openingBalanceCents'], 'Debt opening balance ($)', {kind: 'money', hint: `As of Jan 1, ${String(context.draft.value.startYear ?? plan.startYear)}.`});
    renderField(body, context, ['aprBps'], 'Debt nominal APR (%)', {kind: 'rate', hint: 'APR is an annual percentage.', help: 'How interest is calculated: nominal APR divided by 12, settled monthly; this forecast does not reconstruct daily or variable-rate contract interest.'});
    renderField(body, context, ['monthlyPaymentCents'], 'Debt monthly payment ($)', {kind: 'money'});
    renderField(body, context, ['firstPaymentMonth'], 'Debt first payment month', {kind: 'month'});
  });
  renderEditorGroup(root, {id: 'debt-links', label: 'Property link', advanced: !!context.memory, summary: () => context.draft.value.propertyId ? getRecordLabel(plan, String(context.draft.value.propertyId)) : 'No linked property'}, memory, body => {
    renderField(body, context, ['propertyId'], 'Debt property', {kind: 'select', options: [{value: '', label: 'None'}, ...plan.properties.map(property => ({value: property.id, label: property.name}))], optional: true, hint: 'Add each mortgage once, under its property.'});
  });
}

export function renderExpensesDebtsForm(root: HTMLElement, controller: WorkspaceController, ui?: IssueViewContext, options?: FormRenderOptions): void {
  root.replaceChildren();
  const expenses = element('section'), children = element('section'), debts = element('section'); root.append(expenses, children, debts);
  renderRecordSection(expenses, controller, 'expenses', 'Expense', (body, context) => renderExpenseFields(body, controller, context), undefined, ui, undefined, options);
  if (!options || options.section === 'children') renderChildPlanningForm(children, controller, ui, options);
  renderRecordSection(debts, controller, 'debts', 'Debt', (body, context) => renderDebtFields(body, controller, context), undefined, ui, undefined, options);
}
