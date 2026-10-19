import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, within} from '@testing-library/dom';
import {mountGrowthAssumptions} from '../../src/browser/growth-assumptions-view';
import {createEditPreviewCoordinator} from '../../src/browser/edit-preview';
import {createDisclosureController} from '../../src/browser/disclosures';
import {prepareEdit} from '../../src/browser/state';
import type {PlanDocument} from '../../src/engine';
import {createEditHarness, setDraftField} from '../helpers/editing';
import {makeGrowthPlan, makeScheduledGrowthPlan} from '../helpers/growth';
import {installPreviewWorker} from '../helpers/preview-worker';

let clock: ReturnType<typeof installPreviewWorker>;
const cleanup: (() => void)[] = [];
beforeEach(() => { clock = installPreviewWorker(); });
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); clock.restore(); });
const target = {kind: 'growth-assumptions'} as const;
function setup(plan: PlanDocument = makeScheduledGrowthPlan(), allowActivation = true) {
  const {controller, store} = createEditHarness(plan);
  const root = document.createElement('section'); document.body.append(root);
  let current = true;
  const preview = createEditPreviewCoordinator(controller, {owner: {scenarioId: 'master', sessionGeneration: 1, activationGeneration: 1, workspaceGeneration: 1}, isCurrent: () => current});
  const disclosures = createDisclosureController(root);
  const activate = vi.fn(() => {if (!allowActivation) return false; preview.select(target); return true;});
  const mounted = mountGrowthAssumptions(root, controller, {preview, activate, isCurrent: () => current, context: {disclosures, readState: controller.getState, review() {}}});
  cleanup.push(() => {mounted.dispose(); preview.dispose(); disclosures.dispose(); root.remove();});
  return {root, controller, store, preview, mounted, activate, inactive() {current = false;}};
}
function category(root: HTMLElement, name = 'Stock accounts') {return within(root).getByRole('group', {name});}
function configure(root: HTMLElement, name = 'Stock accounts') {fireEvent.click(within(category(root, name)).getByRole('button', {name: 'Set default'}));}
function memberships(root: HTMLElement, name = 'Stock account membership') {
  const details = within(root).getByText('Choose assets using defaults', {selector: 'summary'}).parentElement as HTMLDetailsElement;
  details.open = true;
  return within(root).getByRole('group', {name});
}
function finishPreview() {clock.flush(100); clock.workers.at(-1)!.reply();}
function configuredPlan() {
  const base = makeGrowthPlan({growthAssumptions: {stocksBps: 700, propertyBps: 300}});
  return {...base, accounts: base.accounts.map(account => account.id === 'stock' ? {...account, growthSource: 'stocks-default' as const} : account)};
}

describe('mounted reviewed growth assumptions', () => {
  it('keeps viewing and membership review passive with no proposed or saved defaults', () => {
    const {root, controller, store, activate} = setup();
    expect(within(root.parentElement!).getByRole('region', {name: 'Growth assumptions'})).toBe(root);
    memberships(root);
    expect(controller.getState().growthDraft).toBeUndefined();
    expect(controller.getState().savedPlan.growthAssumptions).toBeUndefined();
    expect(within(root).queryByRole('slider')).toBeNull();
    expect(activate).not.toHaveBeenCalled(); expect(store.writes()).toBe(0);
  });

  it('stages only an explicitly configured category and uses exact integer slider units', () => {
    const {root, controller} = setup();
    configure(root, 'Properties');
    expect(controller.getGrowthDraft().value.defaults).toEqual({propertyBps: ''});
    const property = within(root).getByRole('slider', {name: 'Property appreciation (%) adjustment'}) as HTMLInputElement;
    expect([property.min, property.max, property.step]).toEqual(['-500', '1500', '10']);
    configure(root);
    expect(controller.getGrowthDraft().value.defaults).toEqual({propertyBps: '', stocksBps: '7.70'});
    const stock = within(root).getByRole('slider', {name: 'Stock account growth (%) adjustment'}) as HTMLInputElement;
    expect([stock.min, stock.max, stock.step]).toEqual(['-1000', '2000', '10']);
    expect(root).toHaveTextContent('Proposed'); expect(root).toHaveTextContent('Affects no assets');
  });

  it('starts only inherited assets checked and selects eligible membership without changing retained rates', () => {
    const plan = configuredPlan(), scheduled = makeScheduledGrowthPlan().accounts.at(-1)!;
    const {root, controller} = setup({...plan, accounts: [...plan.accounts, scheduled]});
    const group = memberships(root);
    expect(within(group).getByRole('checkbox', {name: 'Stock account'})).toBeChecked();
    expect(within(group).getByRole('checkbox', {name: 'Custom Roth'})).not.toBeChecked();
    expect(within(root).queryByRole('checkbox', {name: 'Scheduled RSUs'})).toBeNull();
    fireEvent.click(within(group).getByRole('button', {name: 'Select all'}));
    expect(controller.getGrowthDraft().value.inheritAccountIds).toEqual(['stock', 'custom']);
    expect(category(root)).toHaveTextContent('2 accounts');
    fireEvent.click(within(group).getByRole('button', {name: 'Clear selection'}));
    expect(controller.getGrowthDraft().value.inheritAccountIds).toEqual([]);
    const prepared = prepareEdit(controller, target); if (prepared.status !== 'ready') throw Error('Expected cleared membership candidate');
    expect(prepared.plan.accounts[0]).toMatchObject({annualGrowthBps: 500});
    expect(prepared.plan.accounts[0]).not.toHaveProperty('growthSource');
  });

  it('keeps unscheduled RSUs without optional price targets independent and labeled Custom', () => {
    const plan=makeScheduledGrowthPlan(), scheduled=plan.accounts.at(-1)!;
    const {priceTargets: _targets, ...rsu}=scheduled.rsu!;
    const {root, controller}=setup({...plan, accounts:[...plan.accounts.slice(0,-1), {...scheduled, name:'Unscheduled RSUs', rsu}]});
    memberships(root);expect(root).toHaveTextContent('Unscheduled RSUs · Custom · Own rate 2.00%');
    expect(within(root).queryByRole('checkbox',{name:'Unscheduled RSUs'})).toBeNull();
    expect(controller.getState().growthDraft).toBeUndefined();
  });

  it.each([['25.13', 2513], ['-12.34', -1234]] as const)('retains exact %s outside the convenience slider range', (raw, bps) => {
    const {root, controller} = setup(); configure(root);
    const input = within(root).getByLabelText('Stock account growth (%)') as HTMLInputElement;
    input.focus(); fireEvent.input(input, {target: {value: raw}});
    const prepared = prepareEdit(controller, target); if (prepared.status !== 'ready') throw Error('Expected exact candidate');
    expect(prepared.plan.growthAssumptions?.stocksBps).toBe(bps);
    expect(controller.getGrowthDraft().value.defaults).toEqual({stocksBps: raw});
    expect(input.value).toBe(raw); expect(input).toHaveFocus();
  });

  it('keeps partial text, caret and node identity through paused and completed worker updates', async () => {
    const {root, controller, preview} = setup(); configure(root); finishPreview();
    const input = within(root).getByLabelText('Stock account growth (%)') as HTMLInputElement;
    input.focus(); fireEvent.input(input, {target: {value: '-'}}); input.setSelectionRange(1, 1); clock.flush(100);
    expect(root).toHaveTextContent('Paused'); expect(preview.getState().current).toBeNull();
    expect(controller.getState().savedPlan.growthAssumptions).toBeUndefined();
    expect(within(root).getByLabelText('Stock account growth (%)')).toBe(input);
    expect(input.value).toBe('-'); expect(input.selectionStart).toBe(1); expect(input).toHaveFocus();
    fireEvent.input(input, {target: {value: '8.12'}}); fireEvent.blur(input); await Promise.resolve(); clock.flush(); clock.workers.at(-1)!.reply();
    expect(root).toHaveTextContent('Preview'); expect(preview.getState().current?.prepared.plan.growthAssumptions?.stocksBps).toBe(812);
    expect(within(root).getByLabelText('Stock account growth (%)')).toBe(input);
  });

  it('applies the current receipt once and discards only growth edits', () => {
    const {root, controller, store} = setup();
    setDraftField(controller, {kind: 'record', section: 'accounts', recordId: 'custom'}, ['annualGrowthBps'], 'unfinished');
    configure(root); fireEvent.click(within(memberships(root)).getByRole('checkbox', {name: 'Stock account'})); finishPreview();
    const apply = within(root).getByRole('button', {name: 'Apply growth changes'});
    expect(store.writes()).toBe(0); fireEvent.click(apply); fireEvent.click(apply);
    expect(controller.getState().savedPlan.revision).toBe(1); expect(store.writes()).toBe(1);
    expect(controller.getState().savedPlan.accounts[0]).toMatchObject({annualGrowthBps: 500, growthSource: 'stocks-default'});
    expect(controller.getState().drafts.custom!.value.annualGrowthBps).toBe('unfinished');
    fireEvent.input(within(root).getByLabelText('Stock account growth (%)'), {target: {value: '9.00'}});
    fireEvent.click(within(root).getByRole('button', {name: 'Discard edits'}));
    expect(controller.getState().growthDraft).toBeUndefined(); expect(controller.getState().drafts.custom).toBeDefined();
    expect(within(root).getByLabelText('Stock account growth (%)')).toHaveValue('7.70');
  });

  it('guards failed activation, inactive owners and detached actions', () => {
    const failed = setup(makeGrowthPlan(), false); configure(failed.root);
    expect(failed.controller.getState().growthDraft).toBeUndefined();
    const active = setup(); configure(active.root); finishPreview();
    const apply = within(active.root).getByRole('button', {name: 'Apply growth changes'});
    active.inactive(); fireEvent.click(apply);
    expect(active.controller.getState().savedPlan.revision).toBe(0);
    active.mounted.dispose(); fireEvent.click(apply);
    expect(active.store.writes()).toBe(0);
  });

  it('requires the explicit resume action to replace another preview owner', () => {
    const {root, controller, preview, activate} = setup(configuredPlan());
    const other = {kind: 'record', section: 'accounts', recordId: 'custom'} as const; preview.select(other);
    const input = within(root).getByLabelText('Stock account growth (%)'); expect(input).toBeDisabled();
    fireEvent.input(input, {target: {value: '9.00'}});
    expect(controller.getState().growthDraft).toBeUndefined(); expect(preview.getState().target).toEqual(other); expect(activate).not.toHaveBeenCalled();
    fireEvent.click(within(root).getByRole('button', {name: 'Edit growth assumptions'}));
    expect(preview.getState().target).toEqual(target); expect(input).not.toBeDisabled();
    fireEvent.input(input, {target: {value: '9.00'}}); preview.select(null);
    expect(within(root).getByRole('button', {name: 'Edit growth assumptions'})).toBeVisible(); expect(root).toHaveTextContent('Draft');
  });

  it('shows applied category rates while another editor owns the report and retains the growth proposal', () => {
    const {root, controller, preview} = setup(configuredPlan());
    const input = within(root).getByLabelText('Stock account growth (%)');
    fireEvent.input(input, {target: {value: '8.12'}});
    preview.select({kind: 'record', section: 'accounts', recordId: 'custom'});
    expect(input).toHaveValue('7.00'); expect(category(root)).toHaveTextContent('7.00% annual');
    expect(controller.getGrowthDraft().value.defaults).toMatchObject({stocksBps: '8.12'});
    fireEvent.click(within(root).getByRole('button', {name: 'Edit growth assumptions'}));
    expect(input).toHaveValue('8.12');
  });

  it('shows local persistence failure separately from successfully applied financial inputs', () => {
    const {root, controller, store} = setup(); store.port.setItem = () => {throw Error('quota');};
    configure(root); finishPreview(); fireEvent.click(within(root).getByRole('button', {name: 'Apply growth changes'}));
    expect(controller.getState().savedPlan.growthAssumptions).toEqual({stocksBps: 770});
    expect(root).toHaveTextContent('Applied'); expect(root).toHaveTextContent('Not saved locally'); expect(controller.getState().growthDraft).toBeUndefined();
  });

  it('reveals exact inputs and membership locally without creating a financial draft', () => {
    const {root, mounted, controller} = setup(configuredPlan());
    mounted.reveal('growthAssumptions.stocksBps'); expect(within(root).getByLabelText('Stock account growth (%)')).toHaveFocus();
    mounted.reveal('inheritPropertyIds');
    expect(within(root).getByText('Choose assets using defaults', {selector: 'summary'}).parentElement).toHaveAttribute('open');
    expect(within(root).getByRole('checkbox', {name: 'Owned home'})).toHaveFocus();
    expect(controller.getState().growthDraft).toBeUndefined();
  });
});
