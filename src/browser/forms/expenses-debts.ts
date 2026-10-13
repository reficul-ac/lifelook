import {getRecordLabel} from '../issue-presentation';
import type {IssueViewContext} from '../issue-presentation';
import { taxCategoryOptions,renderField, renderHistory, renderRecordSection, type FieldContext } from '../fields';
import type { WorkspaceController } from '../state';
import { renderChildPlanningForm } from './children';

export function renderExpensesDebtsForm(root: HTMLElement, controller: WorkspaceController, ui?:IssueViewContext): void {
  root.replaceChildren(); const expenses = document.createElement('section'), children = document.createElement('section'), debts = document.createElement('section'); root.append(expenses, children, debts);
  const plan = controller.getState().savedPlan, properties = [{ value: '', label: 'None' }, ...plan.properties.map(p => ({ value: p.id, label: p.name }))];
  renderRecordSection(expenses, controller, 'expenses', 'Expense', (body, ctx) => {
    renderField(body, ctx, ['name'], 'Expense name'); renderField(body, ctx, ['amountCents'], 'Expense amount ($)', { kind: 'money' });
    renderField(body, ctx, ['frequency'], 'Expense frequency', { kind: 'select', options: ['monthly', 'annual'], hint: 'Annual amounts are divided by 12 and budgeted monthly.' });
    renderField(body, ctx, ['startDate'], 'Expense start date', { kind: 'date', hint: 'Monthly budgets begin on this date; no daily proration. Shorter months use their last day.' });
    renderField(body, ctx, ['endDate'], 'Expense end date', { kind: 'date', optional: true,hint:'Includes this date. Blank means no end.' });
    renderField(body, ctx, ['annualGrowthBps'], 'Expense annual growth (%)', { kind: 'rate' });
    renderField(body, ctx, ['propertyId'], 'Expense property', { kind: 'select', options: properties, optional: true, refresh: true });
    const rentals = [{ value: '', label: 'None' }, ...plan.rentals.filter(r => !ctx.draft.value.propertyId || r.propertyId === ctx.draft.value.propertyId).map(r => ({ value: r.id, label: getRecordLabel(plan,r.id) }))];
    renderField(body, ctx, ['rentalId'], 'Expense rental unit', { kind: 'select', options: rentals, optional: true });
    renderField(body, ctx, ['use'], 'Expense use', { kind: 'select', options: ['personal', 'rental', 'shared'], refresh: true });
    renderField(body, ctx, ['taxCategory'], 'Expense tax category', { kind: 'select', options: taxCategoryOptions, refresh: true });
    if (ctx.draft.value.use === 'shared') {
      const toggle: FieldContext = { ...ctx, get draft() { return { ...ctx.draft, value: { ...ctx.draft.value, override: !!ctx.draft.value.allocationOverride } }; }, onChange(_p, value) { ctx.onChange(['allocationOverride'], value ? { numerator: '', denominator: '' } : undefined); } };
      renderField(body, toggle, ['override'], 'Override shared expense allocation', { kind: 'checkbox', refresh: true });
      if (ctx.draft.value.allocationOverride) {
        renderField(body, ctx, ['allocationOverride', 'numerator'], 'Expense allocation Rental portion', { kind: 'integer',visibleLabel:'Rental portion' });
        renderField(body, ctx, ['allocationOverride', 'denominator'], 'Expense allocation Total portions', { kind: 'integer',visibleLabel:'Total portions',hint:'1 of 4 = 25%.' });
      }
    }
    if (ctx.draft.value.taxCategory === 'mortgage-insurance') renderHistory(body, ctx, ['mortgageInsuranceQualification'], 'Qualified mortgage insurance premiums', { kind: 'checkbox' });
  },undefined,ui);
  renderChildPlanningForm(children, controller, ui);
  renderRecordSection(debts, controller, 'debts', 'Debt', (body, ctx) => {
    renderField(body, ctx, ['name'], 'Debt name'); renderField(body, ctx, ['openingBalanceCents'], 'Debt opening balance ($)', { kind: 'money' });
    renderField(body, ctx, ['aprBps'], 'Debt nominal APR (%)', { kind: 'rate', hint: 'APR is an annual percentage.',help:'How interest is calculated: nominal APR divided by 12, settled monthly; this forecast does not reconstruct daily or variable-rate contract interest.' });
    renderField(body, ctx, ['monthlyPaymentCents'], 'Debt monthly payment ($)', { kind: 'money' });
    renderField(body, ctx, ['firstPaymentMonth'], 'Debt first payment month', { kind: 'month' });
    renderField(body, ctx, ['propertyId'], 'Debt property', { kind: 'select', options: properties, optional: true, hint: 'Add each mortgage once, under its property.' });
  },undefined,ui);
}
