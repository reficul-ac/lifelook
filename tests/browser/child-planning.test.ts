import {loadWorkspace} from '../../src/browser/workspace-storage';
import { describe, expect, it } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import { getRecordLabel, resolveIssueTargets } from '../../src/browser/issue-presentation';
import {type StoragePort} from '../../src/browser/storage';
import { mountWorkspace, setField } from '../helpers/dom';
import { makePlan,mustValidate } from '../helpers/plans';

function expenses(plan = makePlan(), storage?: StoragePort) {
  const mounted = mountWorkspace(plan, storage);
  fireEvent.click(within(mounted.root.querySelector('nav')!).getByRole('button', { name: 'Expenses and debts' }));
  return mounted;
}
function childForms(root: HTMLElement): HTMLFormElement[] {
  return [...root.querySelectorAll<HTMLFormElement>('form[data-editable-section="children"]')];
}
function addChild(root: HTMLElement, name: string, birthMonth: string): HTMLFormElement {
  fireEvent.click(within(root).getByRole('button', { name: 'Add child' }));
  const form = childForms(root).at(-1)!;
  setField(form, 'Child name', name);
  setField(form, 'Child birth month', birthMonth);
  return form;
}
function saveChild(form: HTMLElement): void {
  fireEvent.click(within(form).getByRole('button', { name: 'Save child' }));
}

describe('child planning records', () => {
  // Missing month-based controls, a shared child date, publishing drafts early,
  // or dropping child inputs from backups would break this user workflow.
  it('saves independently dated children and reloads their monthly expense budgets', () => {
    const values = new Map<string, string>();
    const storage: StoragePort = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
    let mounted = expenses(makePlan(), storage);
    let form = addChild(mounted.root, 'First child', '2026-05');
    expect(within(form).getByLabelText('Child birth month')).toHaveAttribute('type', 'month');
    expect(mounted.controller.getState().savedPlan.children).toBeUndefined();
    expect(mounted.controller.getState().savedPlan.revision).toBe(0);
    saveChild(form);
    form = addChild(mounted.root, 'Second child', '2026-09');
    saveChild(form);
    const state = mounted.controller.getState();
    expect(state.savedPlan.children).toEqual([
      expect.objectContaining({ name: 'First child', birthMonth: '2026-05', includeAge18: false }),
      expect.objectContaining({ name: 'Second child', birthMonth: '2026-09', includeAge18: false }),
    ]);
    expect(state.savedPlan.revision).toBe(2);
    expect(state.projection.months.map(month => month.expensesCents)).toEqual([
      ...Array(4).fill({ status: 'available', value: 0 }),
      ...Array(4).fill({ status: 'available', value: 75000 }),
      ...Array(4).fill({ status: 'available', value: 150000 }),
    ]);
    expect(state.projection.years[0]?.expensesCents).toEqual({ status: 'available', value: 900000 });
    const backup = mounted.controller.exportBackup();
    expect(JSON.parse(backup).children).toEqual(state.savedPlan.children);
    const loaded = loadWorkspace(storage,()=> 'master');
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') throw new Error('Saved child inputs did not reload');
    mounted = expenses(loaded.document.scenarios.find(s=>s.id===loaded.document.activeScenarioId)!.plan, storage);
    expect(childForms(mounted.root).map(child => within(child).getByLabelText('Child birth month'))).toEqual([
      expect.objectContaining({ value: '2026-05' }), expect.objectContaining({ value: '2026-09' }),
    ]);
    const restored = mounted.manager.replaceScenario(mounted.manager.captureTarget(mounted.manager.getState().document.activeScenarioId)!,mustValidate(JSON.parse(backup)));
    expect(restored.accepted).toBe(true);
    expect(mounted.manager.getActiveSession().controller.getState().savedPlan.children).toEqual(state.savedPlan.children);
  });

  // A checkbox wired only to presentation or a calendar-year cutoff would lose
  // the selected complete age-18 year and its actual expense effect.
  it('opts into the full age-18 year and supports discard and remove', () => {
    const { root, controller } = expenses(makePlan({ children: [{ id: 'child', name: 'Older child', birthMonth: '2008-06', includeAge18: false }] }));
    let form = childForms(root)[0]!;
    expect(controller.getState().projection.months[5]?.expensesCents).toEqual({ status: 'available', value: 0 });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Include full year at age 18' }));
    saveChild(form);
    expect(controller.getState().savedPlan.children?.[0]?.includeAge18).toBe(true);
    expect(controller.getState().projection.years[0]?.expensesCents).toEqual({ status: 'available', value: 1600000 });
    form = childForms(root)[0]!;
    setField(form, 'Child birth month', '2008-10');
    fireEvent.click(within(form).getByRole('button', { name: 'Discard edits' }));
    form = childForms(root)[0]!;
    expect(within(form).getByLabelText('Child birth month')).toHaveValue('2008-06');
    expect(within(form).getByRole('checkbox', { name: 'Include full year at age 18' })).toBeChecked();
    fireEvent.click(within(form).getByRole('button', { name: 'Remove Older child' }));
    expect(controller.getState().savedPlan.children).toEqual([]);
    expect(controller.getState().projection.years[0]?.expensesCents).toEqual({ status: 'available', value: 0 });
  });

  // An invalid birth month must remain a reviewable draft without publishing a
  // new plan revision or replacing the last valid projection.
  it('retains an incomplete child draft and focuses its birth-month error', () => {
    const { root, controller } = expenses(makePlan({ children: [{ id: 'child', name: 'Child', birthMonth: '2026-05', includeAge18: false }] }));
    const form = childForms(root)[0]!, input = within(form).getByLabelText('Child birth month');
    const { savedPlan, projection } = controller.getState();
    setField(form, 'Child birth month', '');
    saveChild(form);
    expect(controller.getState().savedPlan).toBe(savedPlan);
    expect(controller.getState().projection).toBe(projection);
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(within(form).getByRole('button', { name: 'Review Child birth month' }));
    expect(input).toHaveFocus();
    const issue = controller.getState().issues.find(issue => issue.recordId === 'child' && issue.field === 'birthMonth')!;
    expect(resolveIssueTargets(issue, controller.getState())).toEqual([
      expect.objectContaining({ section: 'Expenses and debts', recordId: 'child', field: 'birthMonth', label: 'Review Child' }),
    ]);
    expect(getRecordLabel(savedPlan, 'child')).toBe('Child');
  });

  // Missing optional-collection guards can crash adding the first child to an
  // older plan; saving another record must not publish that unfinished child.
  it('keeps a new child draft independent of an ordinary expense save', () => {
    const { root, controller } = expenses();
    addChild(root, 'Future child', '2027-02');
    fireEvent.click(within(root).getByRole('button', { name: 'Add expense' }));
    const expense = root.querySelector<HTMLFormElement>('form[data-editable-section="expenses"]')!;
    setField(expense, 'Expense amount ($)', '100');
    fireEvent.click(within(expense).getByRole('button', { name: 'Save expense' }));
    expect(controller.getState().savedPlan.children).toBeUndefined();
    expect(childForms(root)).toHaveLength(1);
    expect(within(childForms(root)[0]!).getByLabelText('Child birth month')).toHaveValue('2027-02');
    expect(controller.getState().projection.years[0]?.expensesCents).toEqual({ status: 'available', value: 120000 });
  });

  it('makes age budgets and the planning limits available beside the child controls', () => {
    const { root } = expenses();
    const planning = within(root).getByRole('heading', { name: 'Child planning' }).parentElement!;
    expect(planning).toHaveTextContent(/today.s dollars/i);
    expect(planning).toHaveTextContent('$194,000');
    expect(planning).toHaveTextContent('$210,000');
    expect(planning).toHaveTextContent(/no inflation/i);
    expect(planning).toHaveTextContent(/housing.*medical.*education.*day care/i);
    expect(planning).toHaveTextContent(/tax dependents.*child tax credits/i);
    fireEvent.click(within(planning).getByText('Age-based budgets', { selector: 'summary' }));
    const table = within(planning).getByRole('table', { name: 'Child annual budgets' });
    expect(within(table).getAllByRole('row')).toHaveLength(10);
    expect(within(table).getByRole('cell', { name: '$9,000' })).toBeVisible();
    expect(within(table).getByRole('row', { name: 'Age 18 (optional) $16,000' })).toBeVisible();
  });
});
