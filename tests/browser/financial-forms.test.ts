import {mountWorkspace,setField} from '../helpers/dom';
import { expect, it } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import { renderIncomeForm } from '../../src/browser/forms/income';
import { renderExpensesDebtsForm } from '../../src/browser/forms/expenses-debts';
import { renderInvestmentsForm } from '../../src/browser/forms/investments';
import { createWorkspace, type WorkspaceController } from '../../src/browser/state';
import { calculateProjection, loadRuleSet, validatePlan, type PlanDocument } from '../../src/engine';
import { makePlan } from '../helpers/plans';
import { makeEstimatedMortgagePlan } from '../helpers/estimated-mortgage';
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
  click(root, 'Save salary'); expect(controller.getState().savedPlan.revision).toBe(1);
  expect(controller.getState().savedPlan.salaries[0]?.changes).toEqual([
    { date: '2026-03-15', kind: 'percent', percentBps: 500 }, { date: '2026-09-01', kind: 'amount', annualGrossCents: 13000000 },
  ]);
  click(root, 'Add salary'); const form = draftForm(root, 'Save salary');
  fill(form, 'Salary name', 'Second salary'); fill(draftForm(root, 'Save salary'), 'Annual gross salary ($)', '40000');
  fill(draftForm(root, 'Save salary'), 'Salary owner', 'owner-b');
  fireEvent.click(within(draftForm(root, 'Save salary')).getByRole('button', { name: 'Save salary' }));
  expect(controller.getState().savedPlan.salaries).toHaveLength(2);
  expect(controller.getState().savedPlan.revision).toBe(2); sameCalculation(controller);
});

it('requires wage ownership and employer while retaining entered recurrence units', () => {
  const { root, controller } = mount(renderIncomeForm);
  click(root, 'Add other income'); fill(root, 'Income classification', 'wage');
  fill(root, 'Income name', 'Bonus'); fill(root, 'Income amount ($)', '123.45');
  fill(root, 'Income frequency', 'annual'); fill(root, 'Income annual growth (%)', '3.25'); fill(root, 'Income employer', 'bonus-employer');
  click(root, 'Save other income');
  expect(controller.getState().savedPlan.otherIncome[0]).toMatchObject({ classification: 'wage', ownerId: 'owner-a', employerId: 'bonus-employer', amountCents: 12345, frequency: 'annual', annualGrowthBps: 325 });
  expect(controller.getState().savedPlan.otherIncome[0]).not.toHaveProperty('niitTreatment'); sameCalculation(controller);
});

it('saves monthly and annual expenses and a separate nominal APR debt', () => {
  const { root, controller } = mount(renderExpensesDebtsForm);
  click(root, 'Add expense'); fill(root, 'Expense name', 'Living'); fill(root, 'Expense amount ($)', '100.00'); click(root, 'Save expense');
  click(root, 'Add expense');
  fill(draftForm(root, 'Save expense'), 'Expense name', 'Annual membership');
  fill(draftForm(root, 'Save expense'), 'Expense amount ($)', '1200');
  fill(draftForm(root, 'Save expense'), 'Expense frequency', 'annual');
  fireEvent.click(within(draftForm(root, 'Save expense')).getByRole('button', { name: 'Save expense' }));
  click(root, 'Add debt'); fill(root, 'Debt name', 'Personal debt'); fill(root, 'Debt opening balance ($)', '1000');
  fill(root, 'Debt nominal APR (%)', '6.00'); fill(root, 'Debt monthly payment ($)', '100'); click(root, 'Save debt');
  expect(controller.getState().savedPlan.expenses.map(e => e.frequency)).toEqual(['monthly', 'annual']);
  expect(controller.getState().projection.months.map(month => month.expensesCents)).toEqual(Array(12).fill({ status: 'available', value: 20000 }));
  expect(controller.getState().projection.years[0]?.expensesCents).toEqual({ status: 'available', value: 240000 });
  expect(controller.getState().savedPlan.debts[0]).toMatchObject({ openingBalanceCents: 100000, aprBps: 600, monthlyPaymentCents: 10000 });
  expect(controller.getState().savedPlan.revision).toBe(3); sameCalculation(controller);
});

it('saves all five account types with effective returns and explicit IRA basis', () => {
  const { root, controller } = mount(renderInvestmentsForm);
  const types = ['taxable-brokerage', 'traditional-401k', 'roth-401k', 'traditional-ira', 'roth-ira'];
  for (const type of types) {
    click(root, 'Add account'); let form = draftForm(root, 'Save account');
    fill(form, 'Account name', type); fill(draftForm(root, 'Save account'), 'Account type', type);
    fill(draftForm(root, 'Save account'), 'Account opening balance ($)', '1000');
    fill(draftForm(root, 'Save account'), 'Effective annual account return (%)', '7.00');
    if (type === 'traditional-ira') {
      fill(draftForm(root, 'Save account'), 'After-tax IRA basis at forecast start ($) history', 'known');
      fill(draftForm(root, 'Save account'), 'After-tax IRA basis at forecast start ($) value', '0');
    }
    fireEvent.click(within(draftForm(root, 'Save account')).getByRole('button', { name: 'Save account' }));
  }
  expect(controller.getState().savedPlan.accounts.map(a => a.type)).toEqual(types);
  expect(controller.getState().savedPlan.accounts[3]?.openingIraBasis).toEqual({ known: true, value: 0 });
  expect(controller.getState().savedPlan.revision).toBe(5); sameCalculation(controller);
});

it('saves fixed and salary percentage requests with sponsorship and visible priority', () => {
  const fixture = loadReferences<PlanDocument, unknown>('projection').find(c => c.id === 'two-salaries-home-adu')!.input;
  const { root, controller } = mount(renderInvestmentsForm, makePlan({ household: fixture.household, salaries: fixture.salaries, accounts: fixture.accounts }));
  click(root, 'Add contribution'); fill(root, 'Contribution account', fixture.accounts[0]!.id);
  fill(root, 'Monthly contribution ($)', '100'); fill(root, 'Contribution priority', '2'); click(root, 'Save contribution');
  click(root, 'Add contribution'); fill(draftForm(root, 'Save contribution'), 'Contribution account', fixture.accounts[2]!.id);
  fill(draftForm(root, 'Save contribution'), 'Contribution amount mode', 'salary-percent');
  fill(draftForm(root, 'Save contribution'), 'Contribution salary', fixture.salaries[1]!.id);
  fill(draftForm(root, 'Save contribution'), 'Salary contribution (%)', '10');
  fill(draftForm(root, 'Save contribution'), 'Sponsoring salary', fixture.salaries[1]!.id);
  fill(draftForm(root, 'Save contribution'), 'Contribution priority', '1');
  fireEvent.click(within(draftForm(root, 'Save contribution')).getByRole('button', { name: 'Save contribution' }));
  expect(controller.getState().savedPlan.contributions[0]?.amount).toEqual({ kind: 'fixed', monthlyCents: 10000 });
  expect(controller.getState().savedPlan.contributions[1]).toMatchObject({ priority: 1, sponsoringSalaryId: fixture.salaries[1]!.id, amount: { kind: 'salary-percent', salaryId: fixture.salaries[1]!.id, percentBps: 1000 } });
  expect(controller.getState().savedPlan.revision).toBe(2); sameCalculation(controller);
});

it('keeps short labels, entry consequences and eligibility guidance attached to the native controls',()=>{
  const fixture=loadReferences<PlanDocument,unknown>('projection').find(c=>c.id==='two-salaries-home-adu')!.input;const {root,controller}=mountWorkspace(fixture);const nav=within(root.querySelector('nav')!);
  nav.getByRole('button',{name:'Income'}).click();const salary=[...root.querySelectorAll('form')].find(form=>form.dataset.recordId===fixture.salaries[0]!.id)!;
  const name=salary.querySelector<HTMLElement>('[data-field="name"]')!;expect(name.closest('[data-field-wrapper]')!.querySelector('label')).toHaveTextContent(/^name$/i);expect(name).toHaveAccessibleName('Salary name');
  expect(salary.querySelector('[data-field="endDate"]')).toHaveAccessibleDescription('Includes this date. Blank means no end.');expect(salary.querySelector('[data-field="raiseDay"]')).toHaveAccessibleDescription('Shorter months use their last day.');
  setField(salary,'Salary end date','2026-12-31');fireEvent.click(within(salary).getByText('Save salary',{selector:'button'}));expect(controller.getState().savedPlan.salaries.find(s=>s.id===fixture.salaries[0]!.id)?.endDate).toBe('2026-12-31');sameCalculation(controller);
  nav.getByRole('button',{name:'Expenses and debts'}).click();const expense=root.querySelector<HTMLElement>('[data-section="Expenses and debts"]')!;expect(expense.querySelector('[data-field="startDate"]')).toHaveAccessibleDescription(/Monthly budgets begin on this date/);expect(expense).toHaveTextContent('Add each mortgage once, under its property.');
  nav.getByRole('button',{name:'Investments'}).click();const investments=root.querySelector<HTMLElement>('[data-section="Investments"]')!;expect(investments).toHaveTextContent('Different from account balance; enter 0 only if confirmed.');expect(investments).toHaveTextContent('Lower numbers receive available contribution limits first.');
});

it('keeps qualified schedule-estimated mortgages usable for taxes, ratios and cash funding', () => {
  const { root } = mountWorkspace(makeEstimatedMortgagePlan());
  const queries = within(root);
  const money = /^\$[\d,]+\.\d{2}$/;
  for (const year of [2026, 2027, 2028]) {
    const federal = queries.getByTestId(`annual-${year}-federal-income-tax`);
    const annual = within(federal.closest('section')!);
    expect(federal).toHaveTextContent(money);
    expect(queries.getByTestId(`annual-${year}-california-income-tax`)).toHaveTextContent(money);
    expect(queries.getByTestId(`annual-${year}-cash-flow`)).toHaveTextContent(money);
    expect(queries.getByTestId(`annual-${year}-gross-income`)).toHaveTextContent('$240,000.00');
    for (const label of ['Tax / income', 'Cash flow / income']) {
      expect(annual.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^\d+(?:\.\d{1,2})?%$/);
    }
    expect(annual.getByText('No modeled cash gap')).toBeVisible();
    expect(annual.queryByText('Funding unknown')).toBeNull();
    fireEvent.click(annual.getByRole('button', { name: `Tax explanation for ${year}` }));
    expect(queries.getByTestId(`tax-${year}-federal-total`)).toHaveTextContent(money);
    expect(queries.getByTestId(`tax-${year}-california-total`)).toHaveTextContent(money);
    const explanation = root.querySelector<HTMLElement>(`#tax-explanation-${year}`)!;
    const sources = within(explanation).getByText('Sources and rule assumptions', { selector: 'summary' });
    fireEvent.click(sources);
    expect(within(sources.parentElement!).getByText(/Mortgage interest.*forecast estimates.*loan schedule/, { selector: 'li' })).toBeVisible();
  }
  fireEvent.click(within(root.querySelector('nav')!).getByRole('button', { name: 'Properties' }));
  const summary = queries.getByText(/^Loan — Synthetic fixed mortgage/, { selector: 'summary' });
  expect(summary).toHaveTextContent('Opening balance estimated');
  fireEvent.click(summary);
  expect(queries.getByText(/Saved opening balance: estimated; saved payment: estimated/)).toBeVisible();
  expect(queries.getByLabelText('Opening mortgage balance history')).toHaveValue('unknown');
  expect(queries.getByLabelText('Opening principal-and-interest payment history')).toHaveValue('unknown');
});
