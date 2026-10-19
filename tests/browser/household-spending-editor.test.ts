import {afterEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, within} from '@testing-library/dom';
import {calculateProjection, type PlanDocument} from '../../src/engine';
import {renderHouseholdForm} from '../../src/browser/forms/household';
import {renderExpensesDebtsForm} from '../../src/browser/forms/expenses-debts';
import {createRecordEditorMemory} from '../../src/browser/record-ui-state';
import {createDisclosureController} from '../../src/browser/disclosures';
import {setFormTaskIssues, syncFormFeedback} from '../../src/browser/form-feedback';
import {prepareEdit, type EditableSection} from '../../src/browser/state';
import {createEditHarness} from '../helpers/editing';
import {makePlan} from '../helpers/plans';
import {makeEstimatedMortgagePlan} from '../helpers/estimated-mortgage';
import {loadReferences} from '../helpers/references';
import {setField} from '../helpers/dom';

const cleanup: (() => void)[] = [];
afterEach(() => {for (const dispose of cleanup.splice(0)) dispose();});
function mount(section: EditableSection, recordId: string, plan = makePlan()) {
  const {controller, store} = createEditHarness(plan), memory = createRecordEditorMemory();
  const editor = document.createElement('section'); document.body.replaceChildren(editor);
  const disclosures = createDisclosureController(editor); cleanup.push(() => disclosures.dispose());
  const context = {disclosures, readState: controller.getState, review: () => {}};
  const target = {kind: 'record', section, recordId} as const;
  (section === 'household' ? renderHouseholdForm : renderExpensesDebtsForm)(editor, controller, context, {section, recordId, memory, onSubmit: vi.fn()});
  return {editor, controller, store, target, context};
}
function group(editor: HTMLElement, id: string): HTMLDetailsElement {
  const node = editor.querySelector<HTMLDetailsElement>(`details[data-editor-group="${id}"]`);
  expect(node).not.toBeNull(); return node!;
}
function open(editor: HTMLElement, id: string): HTMLDetailsElement {const node = group(editor, id); node.open = true; fireEvent(node, new Event('toggle')); return node;}

describe('focused household, spending, debt and child entry', () => {
  it('starts with people, forecast and cash while retaining hidden explicit employer history', () => {
    const base = makeEstimatedMortgagePlan();
    const plan = {...base, household: {...base.household, filers: [{...base.household.filers[0], employerAssumptionsByYear: [{year: 2026, employerId: 'employer-a', priorYearWagesCents: {known: true, value: 0}, planCatchUpAvailable: {known: false}, rothCatchUpAvailable: {known: true, value: false}}]}, base.household.filers[1]]}} as PlanDocument;
    const {editor, controller, target, store} = mount('household', 'household', plan);
    for (const label of ['Filer 1 name', 'Filer 2 name', 'Projection start year', 'Projection years', 'Opening cash reserve ($)']) expect(within(editor).getByLabelText(label)).toBeVisible();
    expect(group(editor, 'household-retirement').open).toBe(false);
    expect(group(editor, 'household-tax-coverage').open).toBe(false);
    open(editor, 'household-retirement');
    expect(within(editor).getByLabelText('Filer 1 prior-year employer wages 1 ($) value')).toHaveValue('0.00');
    expect(within(editor).getByLabelText('Filer 1 employer offers catch-up 1')).toHaveValue('unknown');
    group(editor, 'household-retirement').open = false;
    setField(editor, 'Opening cash reserve ($)', '123.45');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected household candidate');
    expect(prepared.plan.household.filers[0]?.employerAssumptionsByYear).toEqual(plan.household.filers[0]?.employerAssumptionsByYear);
    expect(prepared.plan.openingCashCents).toBe(12345);
    open(editor, 'household-retirement');
    expect(within(editor).getByLabelText('Filer 1 employer offers catch-up 1')).toHaveValue('unknown');
    expect(store.writes()).toBe(0);
  });

  it('holds advanced validation until blur and reveals the hidden input through Review', () => {
    const {editor, controller, target, context} = mount('household', 'household');
    const advanced = open(editor, 'household-tax-policy');
    const input = within(editor).getByLabelText('Future tax threshold growth (%)');
    setField(editor, 'Future tax threshold growth (%)', '1.234');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'invalid') throw Error('Expected invalid rate');
    setFormTaskIssues(editor.querySelector('form')!, prepared.issues);
    syncFormFeedback(editor, controller, context);
    expect(input).not.toHaveAttribute('aria-invalid');
    input.focus(); input.blur();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    advanced.open = false;
    fireEvent.click(within(editor).getByRole('button', {name: 'Review Future tax threshold growth (%)'}));
    expect(advanced.open).toBe(true);
    expect(input).toHaveFocus();
  });

  it('retains annual expense units, negative growth and inclusive end dates', () => {
    const plan = makePlan({expenses: [{id: 'expense', name: 'Annual budget', amountCents: 120000, frequency: 'annual', startDate: '2026-01-01', annualGrowthBps: 0, use: 'personal', taxCategory: 'personal'}]});
    const {editor, controller, target} = mount('expenses', 'expense', plan);
    expect(within(editor).getByLabelText('Expense frequency')).toHaveValue('annual');
    expect(within(editor).getByLabelText('Expense amount ($)')).toHaveValue('1200.00');
    open(editor, 'expense-growth');
    setField(editor, 'Expense annual growth (%)', '-1.25');
    setField(editor, 'Expense end date', '2026-01-01');
    group(editor, 'expense-growth').open = false;
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected annual expense candidate');
    expect(prepared.plan.expenses[0]).toMatchObject({amountCents: 120000, frequency: 'annual', annualGrowthBps: -125, endDate: '2026-01-01'});
    expect(calculateProjection(prepared.plan, prepared.ruleSet).years[0]?.expensesCents).toEqual({status: 'available', value: 10000});
    setField(editor, 'Expense frequency', 'monthly');
    expect(controller.getDraft('expenses', 'expense').value.amountCents).toBe('1200.00');
  });

  it('retains rental and property links with an explicit shared allocation', () => {
    const plan = loadReferences<PlanDocument, unknown>('projection').find(item => item.id === 'two-salaries-home-adu')!.input;
    const expense = plan.expenses[0]!, rental = plan.rentals[0]!;
    const {editor, controller, target} = mount('expenses', expense.id, plan);
    open(editor, 'expense-tax');
    setField(editor, 'Expense property', rental.propertyId);
    setField(editor, 'Expense rental unit', rental.id);
    setField(editor, 'Expense use', 'shared');
    if (!(within(editor).getByLabelText('Override shared expense allocation') as HTMLInputElement).checked) fireEvent.click(within(editor).getByLabelText('Override shared expense allocation'));
    setField(editor, 'Expense allocation Rental portion', '1'); setField(editor, 'Expense allocation Total portions', '4');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error(`Expected shared expense candidate: ${JSON.stringify(prepared)}`);
    expect(prepared.plan.expenses.find(item => item.id === expense.id)).toMatchObject({propertyId: rental.propertyId, rentalId: rental.id, use: 'shared', allocationOverride: {numerator: 1, denominator: 4}});
  });

  it('keeps reversible allocation overrides outside inactive expense modes', () => {
    const plan = makePlan({expenses: [{id: 'expense', name: 'Personal', amountCents: 10000, frequency: 'monthly', startDate: '2026-01-01', annualGrowthBps: 0, use: 'personal', taxCategory: 'personal'}]});
    const {editor, controller} = mount('expenses', 'expense', plan);
    open(editor, 'expense-tax'); setField(editor, 'Expense use', 'shared');
    fireEvent.click(within(editor).getByLabelText('Override shared expense allocation'));
    setField(editor, 'Expense allocation Rental portion', '-'); setField(editor, 'Expense allocation Total portions', '4');
    setField(editor, 'Expense use', 'personal');
    expect(controller.getDraft('expenses', 'expense').value).not.toHaveProperty('allocationOverride');
    setField(editor, 'Expense use', 'shared');
    expect(within(editor).getByLabelText('Expense allocation Rental portion')).toHaveValue('-');
    expect(within(editor).getByLabelText('Expense allocation Total portions')).toHaveValue('4');
  });

  it('uses an independent first-payment month without duplicating the saved mortgage', () => {
    const base = makeEstimatedMortgagePlan();
    const plan = {...base, debts: [{id: 'debt', name: 'Personal loan', openingBalanceCents: 100000, aprBps: 600, monthlyPaymentCents: 10000, firstPaymentMonth: '2026-01'}]};
    const {editor, controller, target} = mount('debts', 'debt', plan);
    expect(group(editor, 'debt-links').open).toBe(false);
    const month = within(editor).getByLabelText('Debt first payment month');
    expect(month).toHaveAttribute('type', 'month'); setField(editor, 'Debt first payment month', '2026-07');
    expect(editor).toHaveTextContent('Add each mortgage once, under its property.');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected debt candidate');
    expect(prepared.plan.debts[0]).toMatchObject({firstPaymentMonth: '2026-07', aprBps: 600, monthlyPaymentCents: 10000});
    expect(prepared.plan.properties[0]?.loans).toEqual(plan.properties[0]?.loans);
    expect(prepared.plan.expenses).toEqual(plan.expenses);
    const projection = calculateProjection(prepared.plan, prepared.ruleSet);
    expect(projection.months[0]?.loans).toHaveLength(2);
    expect(projection.months[0]?.loans.filter(loan => loan.loanId === 'home-loan')).toHaveLength(1);
    expect(projection.months[0]?.loans.find(loan => loan.loanId === 'debt')?.paymentCents).toEqual({status: 'available', value: 0});
  });

  it('keeps child budgets separate from tax-dependent facts and retains age-band exclusions', () => {
    const plan = makePlan({children: [{id: 'child', name: 'Child', birthMonth: '2026-05', includeAge18: false}]});
    const {editor, controller, target, store} = mount('children', 'child', plan);
    expect(within(editor).getByLabelText('Child birth month')).toHaveAttribute('type', 'month');
    setField(editor, 'Child birth month', '2026-06');
    fireEvent.click(within(editor).getByLabelText('Include full year at age 18'));
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected child candidate');
    expect(prepared.plan.children?.[0]).toMatchObject({birthMonth: '2026-06', includeAge18: true});
    expect(prepared.plan.household.coverageAnswers).toEqual(plan.household.coverageAnswers);
    expect(editor).toHaveTextContent(/housing.*medical.*education.*day care/);
    const budgets = open(editor, 'child-budget-model');
    expect(within(budgets).getByRole('table', {name: 'Child annual budgets'})).toBeVisible();
    expect(store.writes()).toBe(0);
  });
});
