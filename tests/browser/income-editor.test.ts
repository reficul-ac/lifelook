import {describe, expect, it, vi} from 'vitest';
import {fireEvent, within} from '@testing-library/dom';
import {calculateProjection, type PlanDocument} from '../../src/engine';
import {renderIncomeForm} from '../../src/browser/forms/income';
import {prepareEdit} from '../../src/browser/state';
import {createRecordEditorMemory} from '../../src/browser/record-ui-state';
import {createEditHarness} from '../helpers/editing';
import {makeAllocationPlan} from '../helpers/allocations';
import {makePlan} from '../helpers/plans';
import {setField} from '../helpers/dom';

function mountIncome(section: 'salaries' | 'otherIncome' = 'salaries', plan: PlanDocument = makeAllocationPlan()) {
  const {controller, store} = createEditHarness(plan);
  const editor = document.createElement('section'); document.body.replaceChildren(editor);
  const target = {kind: 'record', section, recordId: section === 'salaries' ? 'salary-a' : 'bonus'} as const;
  const memory = createRecordEditorMemory();
  renderIncomeForm(editor, controller, undefined, {...target, memory, onSubmit: vi.fn()});
  return {editor, controller, store, target};
}
function growth(editor: HTMLElement): HTMLDetailsElement {
  return within(editor).getByText(/^Growth and changes/, {selector: 'summary'}).parentElement as HTMLDetailsElement;
}
function openGrowth(editor: HTMLElement): void { const group = growth(editor); group.open = true; fireEvent(group, new Event('toggle')); }

describe('focused salary and other income entry', () => {
  it('shows one salary’s essential facts and its actual employer identity before collapsed growth', () => {
    const {editor, controller} = mountIncome();
    expect(editor.querySelectorAll('form')).toHaveLength(1);
    for (const label of ['Salary name', 'Salary owner', 'Salary employer', 'Annual gross salary ($)', 'Salary start date']) {
      expect(within(editor).getByLabelText(label)).toBeVisible();
    }
    expect(within(editor).getByLabelText('Salary employer')).toHaveValue('employer-0');
    const employer = within(editor).getByLabelText('Salary employer');
    const choices = editor.querySelector(`#${employer.getAttribute('list')}`)!;
    expect(choices.querySelector('option[value="employer-0"]')).toHaveAttribute('label', 'salary-a · employer-0');
    expect(growth(editor).open).toBe(false);
    expect(growth(editor).querySelector('summary')).toHaveTextContent('0% each January 1');
    expect(controller.getState().drafts).toEqual({});
  });

  it('keeps annual growth, cap, end date and February 31 active while hidden', () => {
    const {editor, controller, store, target} = mountIncome();
    openGrowth(editor);
    setField(editor, 'Annual salary raise (%)', '3.00');
    setField(editor, 'Automatic salary raise cap ($)', '130000.00');
    setField(editor, 'Salary raise month', '2');
    setField(editor, 'Salary raise day', '31');
    setField(editor, 'Salary end date', '2026-12-31');
    growth(editor).open = false;
    expect(growth(editor).querySelector('summary')).toHaveTextContent('3% each February 31');
    const prepared = prepareEdit(controller, target);
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') throw Error('Expected salary candidate');
    expect(prepared.plan.salaries[0]).toMatchObject({annualRaiseBps: 300, annualRaiseCapCents: 13000000, raiseMonth: 2, raiseDay: 31, endDate: '2026-12-31'});
    expect(store.writes()).toBe(0);
    expect(controller.getState().savedPlan.revision).toBe(0);
  });

  it('restores invalid percentage and exact amount modes without replacing a manually edited date', () => {
    const {editor, controller, target} = mountIncome(); openGrowth(editor);
    fireEvent.click(within(editor).getByRole('button', {name: 'Add salary change'}));
    setField(editor, 'Salary change date 1', '2026-06-01');
    setField(editor, 'Salary change percentage 1 (%)', '-');
    setField(editor, 'Salary change type 1', 'amount');
    setField(editor, 'Salary change annual amount 1 ($)', '123456.78');
    setField(editor, 'Salary change date 1', '2026-07-01');
    setField(editor, 'Salary change type 1', 'percent');
    expect(within(editor).getByLabelText('Salary change percentage 1 (%)')).toHaveValue('-');
    expect(within(editor).getByLabelText('Salary change date 1')).toHaveValue('2026-07-01');
    expect(prepareEdit(controller, target).status).toBe('invalid');
    setField(editor, 'Salary change type 1', 'amount');
    expect(within(editor).getByLabelText('Salary change annual amount 1 ($)')).toHaveValue('123456.78');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected restored amount candidate');
    expect(prepared.plan.salaries[0]?.changes).toEqual([{date: '2026-07-01', kind: 'amount', annualGrossCents: 12345678}]);
  });

  it('prepares both dated raise types and rejects a cap below starting pay without publishing', () => {
    const {editor, controller, target, store} = mountIncome(); openGrowth(editor);
    fireEvent.click(within(editor).getByRole('button', {name: 'Add salary change'}));
    setField(editor, 'Salary change date 1', '2026-04-01');
    setField(editor, 'Salary change percentage 1 (%)', '-1.25');
    fireEvent.click(within(editor).getByRole('button', {name: 'Add salary change'}));
    setField(editor, 'Salary change date 2', '2026-08-01');
    setField(editor, 'Salary change type 2', 'amount');
    setField(editor, 'Salary change annual amount 2 ($)', '140000.00');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected dated salary candidate');
    expect(prepared.plan.salaries[0]?.changes).toEqual([{date: '2026-04-01', kind: 'percent', percentBps: -125}, {date: '2026-08-01', kind: 'amount', annualGrossCents: 14000000}]);
    const {savedPlan, projection} = controller.getState();
    setField(editor, 'Automatic salary raise cap ($)', '99999.99');
    const invalid = prepareEdit(controller, target);
    expect(invalid.status).toBe('invalid');
    if (invalid.status !== 'invalid') throw Error('Expected cap validation');
    expect(invalid.issues).toContainEqual(expect.objectContaining({field: 'annualRaiseCapCents'}));
    expect(controller.getState().savedPlan).toBe(savedPlan);
    expect(controller.getState().projection).toBe(projection);
    expect(store.writes()).toBe(0);
  });

  it('retains an inclusive salary end date in the candidate calculation', () => {
    const salary = makeAllocationPlan().salaries[0]!;
    const {editor, controller, target} = mountIncome('salaries', makePlan({salaries: [{...salary, annualGrossCents: 3720000}]}));
    openGrowth(editor); setField(editor, 'Salary end date', '2026-01-01');
    expect(within(editor).getByLabelText('Salary end date')).toHaveAccessibleDescription('Includes this date. Blank means no end.');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected inclusive date candidate');
    // $37,200 / 12 / 31 = $100 earned on January 1, inclusive.
    expect(calculateProjection(prepared.plan, prepared.ruleSet).years[0]?.grossIncomeCents).toEqual({status: 'available', value: 10000});
  });

  it('reverses wage classifications with employer, owner, NIIT and invalid raw amount intact', () => {
    const plan = makePlan({otherIncome: [{id: 'bonus', name: 'Bonus', amountCents: 12345, frequency: 'annual', startDate: '2026-01-01', annualGrowthBps: 0, classification: 'wage', ownerId: 'owner-b', employerId: 'linked-employer'}]});
    const {editor, controller, store, target} = mountIncome('otherIncome', plan);
    setField(editor, 'Income amount ($)', '1,23');
    setField(editor, 'Income classification', 'ordinary-taxable');
    setField(editor, 'Income NIIT treatment', 'included');
    setField(editor, 'Income classification', 'wage');
    expect(within(editor).getByLabelText('Income owner')).toHaveValue('owner-b');
    expect(within(editor).getByLabelText('Income employer')).toHaveValue('linked-employer');
    expect(within(editor).getByLabelText('Income amount ($)')).toHaveValue('1,23');
    expect(controller.getDraft('otherIncome', 'bonus').value).not.toHaveProperty('niitTreatment');
    setField(editor, 'Income classification', 'ordinary-taxable');
    expect(within(editor).getByLabelText('Income NIIT treatment')).toHaveValue('included');
    setField(editor, 'Income amount ($)', '123.45');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected ordinary income candidate');
    expect(prepared.plan.otherIncome[0]).toMatchObject({classification: 'ordinary-taxable', niitTreatment: 'included', amountCents: 12345});
    expect(prepared.plan.otherIncome[0]).not.toHaveProperty('employerId');
    expect(store.writes()).toBe(0);
  });

  it('summarizes a hidden negative income growth assumption without changing recurrence units', () => {
    const plan = makePlan({otherIncome: [{id: 'bonus', name: 'Bonus', amountCents: 120000, frequency: 'annual', startDate: '2026-01-01', annualGrowthBps: 0, classification: 'non-taxable'}]});
    const {editor, controller, target} = mountIncome('otherIncome', plan);
    const group = within(editor).getByText(/^Growth and dates/, {selector: 'summary'}).parentElement as HTMLDetailsElement;
    group.open = true;
    setField(editor, 'Income annual growth (%)', '-2.50');
    group.open = false;
    expect(group.querySelector('summary')).toHaveTextContent('-2.5% annual growth');
    const prepared = prepareEdit(controller, target);
    if (prepared.status !== 'ready') throw Error('Expected income growth candidate');
    expect(prepared.plan.otherIncome[0]).toMatchObject({annualGrowthBps: -250, amountCents: 120000, frequency: 'annual'});
  });
});
