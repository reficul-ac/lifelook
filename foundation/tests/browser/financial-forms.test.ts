import { expect, it } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import { renderIncomeForm } from '../../src/browser/forms/income';
import { renderExpensesDebtsForm } from '../../src/browser/forms/expenses-debts';
import { renderInvestmentsForm } from '../../src/browser/forms/investments';
import { createWorkspace, type WorkspaceController } from '../../src/browser/state';
import { calculateProjection, loadRuleSet, validatePlan, type PlanDocument } from '../../src/engine';
import { makePlan } from '../helpers/plans';
import { loadReferences } from '../helpers/references';

function mount(renderer: (root: HTMLElement, controller: WorkspaceController) => void, plan = makePlan()) {
  const root = document.createElement('section'); document.body.replaceChildren(root);
  const controller = createWorkspace(plan, { getItem: () => null, setItem: () => {} }, loadRuleSet());
  controller.subscribe(() => renderer(root, controller)); renderer(root, controller);
  return { root, controller };
}
function fill(root: HTMLElement, label: string, value: string) {
  const control = within(root).getByLabelText(label);
  fireEvent[control instanceof HTMLSelectElement ? 'change' : 'input'](control, { target: { value } });
}
function click(root: HTMLElement, name: string) { fireEvent.click(within(root).getByRole('button', { name })); }
function draftForm(root: HTMLElement, save: string) {
  return within(root).getAllByRole('button', { name: save }).at(-1)!.closest('form')!;
}
function sameCalculation(controller: WorkspaceController) {
  const state = controller.getState(), validated = validatePlan(state.savedPlan);
  if (!validated.ok) throw new Error('Saved invalid plan');
  expect(state.projection).toEqual(calculateProjection(validated.plan, loadRuleSet()));
  expect(state.projection.inputRevision).toBe(state.savedPlan.revision);
}

it('saves two salaries and dated percentage and amount raises as atomic records', () => {
  const { root, controller } = mount(renderIncomeForm);
  click(root, 'Add salary');
  fill(root, 'Salary name', 'First salary'); fill(root, 'Annual gross salary ($)', '120000.00');
  fill(root, 'Salary employer', 'employer-a'); fill(root, 'Annual salary raise (%)', '2.00');
  fill(root, 'Salary raise month', '7'); fill(root, 'Salary raise day', '1');
  click(root, 'Add salary change'); fill(root, 'Salary change date 1', '2026-03-15'); fill(root, 'Salary change percentage 1 (%)', '5.00');
  click(root, 'Add salary change'); fill(root, 'Salary change date 2', '2026-09-01');
  fill(root, 'Salary change type 2', 'amount'); fill(root, 'Salary change annual amount 2 ($)', '130000.00');
  expect(controller.getState().savedPlan.revision).toBe(0);
  click(root, 'Save salary record'); expect(controller.getState().savedPlan.revision).toBe(1);
  expect(controller.getState().savedPlan.salaries[0]?.changes).toEqual([
    { date: '2026-03-15', kind: 'percent', percentBps: 500 }, { date: '2026-09-01', kind: 'amount', annualGrossCents: 13000000 },
  ]);
  click(root, 'Add salary'); const form = draftForm(root, 'Save salary record');
  fill(form, 'Salary name', 'Second salary'); fill(draftForm(root, 'Save salary record'), 'Annual gross salary ($)', '40000');
  fill(draftForm(root, 'Save salary record'), 'Salary owner', 'owner-b');
  fireEvent.click(within(draftForm(root, 'Save salary record')).getByRole('button', { name: 'Save salary record' }));
  expect(controller.getState().savedPlan.salaries).toHaveLength(2);
  expect(controller.getState().savedPlan.revision).toBe(2); sameCalculation(controller);
});

it('requires wage ownership and employer while retaining entered recurrence units', () => {
  const { root, controller } = mount(renderIncomeForm);
  click(root, 'Add other income'); fill(root, 'Income classification', 'wage');
  fill(root, 'Income name', 'Bonus'); fill(root, 'Income amount ($)', '123.45');
  fill(root, 'Income frequency', 'annual'); fill(root, 'Income annual growth (%)', '3.25'); fill(root, 'Income employer', 'bonus-employer');
  click(root, 'Save other income record');
  expect(controller.getState().savedPlan.otherIncome[0]).toMatchObject({ classification: 'wage', ownerId: 'owner-a', employerId: 'bonus-employer', amountCents: 12345, frequency: 'annual', annualGrowthBps: 325 });
  expect(controller.getState().savedPlan.otherIncome[0]).not.toHaveProperty('niitTreatment'); sameCalculation(controller);
});

it('saves monthly and annual expenses and a separate nominal APR debt', () => {
  const { root, controller } = mount(renderExpensesDebtsForm);
  click(root, 'Add expense'); fill(root, 'Expense name', 'Living'); fill(root, 'Expense amount ($)', '100.00'); click(root, 'Save expense record');
  click(root, 'Add expense');
  fill(draftForm(root, 'Save expense record'), 'Expense name', 'Annual membership');
  fill(draftForm(root, 'Save expense record'), 'Expense amount ($)', '1200');
  fill(draftForm(root, 'Save expense record'), 'Expense frequency', 'annual');
  fireEvent.click(within(draftForm(root, 'Save expense record')).getByRole('button', { name: 'Save expense record' }));
  click(root, 'Add debt'); fill(root, 'Debt name', 'Personal debt'); fill(root, 'Debt opening balance ($)', '1000');
  fill(root, 'Debt nominal APR (%)', '6.00'); fill(root, 'Debt monthly payment ($)', '100'); click(root, 'Save debt record');
  expect(controller.getState().savedPlan.expenses.map(e => e.frequency)).toEqual(['monthly', 'annual']);
  expect(controller.getState().savedPlan.debts[0]).toMatchObject({ openingBalanceCents: 100000, aprBps: 600, monthlyPaymentCents: 10000 });
  expect(controller.getState().savedPlan.revision).toBe(3); sameCalculation(controller);
});

it('saves all five account types with effective returns and explicit IRA basis', () => {
  const { root, controller } = mount(renderInvestmentsForm);
  const types = ['taxable-brokerage', 'traditional-401k', 'roth-401k', 'traditional-ira', 'roth-ira'];
  for (const type of types) {
    click(root, 'Add account'); let form = draftForm(root, 'Save account record');
    fill(form, 'Account name', type); fill(draftForm(root, 'Save account record'), 'Account type', type);
    fill(draftForm(root, 'Save account record'), 'Account opening balance ($)', '1000');
    fill(draftForm(root, 'Save account record'), 'Effective annual account return (%)', '7.00');
    if (type === 'traditional-ira') {
      fill(draftForm(root, 'Save account record'), 'Opening traditional IRA basis history', 'known');
      fill(draftForm(root, 'Save account record'), 'Opening traditional IRA basis value', '0');
    }
    fireEvent.click(within(draftForm(root, 'Save account record')).getByRole('button', { name: 'Save account record' }));
  }
  expect(controller.getState().savedPlan.accounts.map(a => a.type)).toEqual(types);
  expect(controller.getState().savedPlan.accounts[3]?.openingIraBasis).toEqual({ known: true, value: 0 });
  expect(controller.getState().savedPlan.revision).toBe(5); sameCalculation(controller);
});

it('saves fixed and salary percentage requests with sponsorship and visible priority', () => {
  const fixture = loadReferences<PlanDocument, unknown>('projection').find(c => c.id === 'two-salaries-home-adu')!.input;
  const { root, controller } = mount(renderInvestmentsForm, makePlan({ household: fixture.household, salaries: fixture.salaries, accounts: fixture.accounts }));
  click(root, 'Add contribution'); fill(root, 'Contribution account', fixture.accounts[0]!.id);
  fill(root, 'Monthly contribution ($)', '100'); fill(root, 'Contribution priority', '2'); click(root, 'Save contribution record');
  click(root, 'Add contribution'); fill(draftForm(root, 'Save contribution record'), 'Contribution account', fixture.accounts[2]!.id);
  fill(draftForm(root, 'Save contribution record'), 'Contribution amount mode', 'salary-percent');
  fill(draftForm(root, 'Save contribution record'), 'Contribution salary', fixture.salaries[1]!.id);
  fill(draftForm(root, 'Save contribution record'), 'Salary contribution (%)', '10');
  fill(draftForm(root, 'Save contribution record'), 'Sponsoring salary', fixture.salaries[1]!.id);
  fill(draftForm(root, 'Save contribution record'), 'Contribution priority', '1');
  fireEvent.click(within(draftForm(root, 'Save contribution record')).getByRole('button', { name: 'Save contribution record' }));
  expect(controller.getState().savedPlan.contributions[0]?.amount).toEqual({ kind: 'fixed', monthlyCents: 10000 });
  expect(controller.getState().savedPlan.contributions[1]).toMatchObject({ priority: 1, sponsoringSalaryId: fixture.salaries[1]!.id, amount: { kind: 'salary-percent', salaryId: fixture.salaries[1]!.id, percentBps: 1000 } });
  expect(controller.getState().savedPlan.revision).toBe(2); sameCalculation(controller);
});
