import {describe, expect, it} from 'vitest';
import {fireEvent, waitFor, within} from '@testing-library/dom';
import {mountWorkspace, setField} from '../helpers/dom';
import {makeAllocationPlan} from '../helpers/allocations';
import {applyEdit,openRecord} from '../helpers/workspace-ui';
import {createWorkspace,prepareEdit} from '../../src/browser/state';
import {accountGrowthRate} from '../../src/engine';
import {makeGrowthPlan} from '../helpers/growth';
import {memoryWorkspaceStorage} from '../helpers/scenarios';

describe('account entry', () => {
  it('applies a custom exception while retaining the inherited account custom rate and unknown basis', async () => {
    const base=makeGrowthPlan({growthAssumptions:{stocksBps:770}}),plan={...base,accounts:base.accounts.map(a=>a.id==='stock'?{...a,growthSource:'stocks-default' as const,openingTaxableBasis:{known:false as const}}:a)};
    const store=memoryWorkspaceStorage(),{root,controller}=mountWorkspace(plan,store.port),editor=openRecord(root,{kind:'record',section:'accounts',recordId:'stock'});
    expect(within(editor).getByLabelText('Account growth source')).toHaveValue('stocks-default');
    expect(within(editor).getByRole('option',{name:'Category default'})).toBeDefined();
    expect(editor).toHaveTextContent('7.70% annual return');
    expect(within(editor).queryByLabelText('Effective annual account return (%)')).toBeNull();
    setField(editor,'Account growth source','custom');
    expect(within(editor).getByLabelText('Effective annual account return (%)')).toHaveValue('5.00');
    setField(editor,'Account growth source','stocks-default');setField(editor,'Account growth source','custom');
    expect(within(editor).getByLabelText('Effective annual account return (%)')).toHaveValue('5.00');
    expect(store.writes()).toBe(0);expect(controller.getState().savedPlan.revision).toBe(0);
    await applyEdit(root);const saved=controller.getState().savedPlan;
    expect(saved.accounts[0]!.annualGrowthBps).toBe(500);expect(saved.accounts[0]!.growthSource).toBeUndefined();
    expect(saved.accounts[0]!.openingTaxableBasis).toEqual({known:false});expect(accountGrowthRate(saved.accounts[0]!,saved.growthAssumptions)).toBe(500);expect(saved.revision).toBe(1);
  });
  it('previews and applies explicit inheritance without replacing a custom return', async () => {
    const store=memoryWorkspaceStorage(),{root,controller}=mountWorkspace(makeGrowthPlan({growthAssumptions:{stocksBps:770}}),store.port),editor=openRecord(root,{kind:'record',section:'accounts',recordId:'stock'});
    expect(within(editor).getByLabelText('Account growth source')).toHaveValue('custom');
    setField(editor,'Account growth source','stocks-default');
    const candidate=prepareEdit(controller,{kind:'record',section:'accounts',recordId:'stock'});expect(candidate.status).toBe('ready');
    if(candidate.status!=='ready')throw Error('candidate required');expect(accountGrowthRate(candidate.plan.accounts[0]!,candidate.plan.growthAssumptions)).toBe(770);
    expect(store.writes()).toBe(0);await applyEdit(root);const saved=controller.getState().savedPlan;
    expect(saved.accounts[0]!.annualGrowthBps).toBe(500);expect(saved.accounts[0]!.growthSource).toBe('stocks-default');
  });
  it('retains explicit stock inheritance when changing an ordinary account tax wrapper',()=>{
    const base=makeGrowthPlan({growthAssumptions:{stocksBps:770}}),plan={...base,accounts:base.accounts.map(a=>a.id==='stock'?{...a,growthSource:'stocks-default' as const}:a)};
    const {root,controller}=mountWorkspace(plan),editor=openRecord(root,{kind:'record',section:'accounts',recordId:'stock'});setField(editor,'Account type','roth-ira');
    expect(within(editor).getByLabelText('Account growth source')).toHaveValue('stocks-default');expect(controller.getDraft('accounts','stock').value.annualGrowthBps).toBe('5.00');
  });
  it('initializes new ordinary accounts from applied defaults while legacy accounts stay custom', () => {
    const store=memoryWorkspaceStorage(),controller=createWorkspace(makeGrowthPlan({growthAssumptions:{stocksBps:0}}),store.port),growth=controller.getGrowthDraft();
    controller.editGrowthDraft({...growth,value:{...growth.value,defaults:{stocksBps:'15.00'}}});
    const id=controller.beginAdd('accounts');expect(controller.getDraft('accounts',id).value).toMatchObject({growthSource:'stocks-default',annualGrowthBps:'0.00'});
    expect(controller.getState().savedPlan.accounts[0]!.growthSource).toBeUndefined();
    const legacy=createWorkspace(makeGrowthPlan(),memoryWorkspaceStorage().port),proposal=legacy.getGrowthDraft();legacy.editGrowthDraft({...proposal,value:{...proposal.value,defaults:{stocksBps:'15.00'}}});const legacyId=legacy.beginAdd('accounts');
    expect(legacy.getDraft('accounts',legacyId).value.growthSource).toBeUndefined();expect(legacy.getDraft('accounts',legacyId).value.annualGrowthBps).toBe('0.00');
    expect(store.writes()).toBe(0);
  });
  it('associates a blurred rate error with both exact input and supplemental slider', async () => {
    const {root} = mountWorkspace(makeAllocationPlan());
    const editor = openRecord(root, {kind: 'record', section: 'accounts', recordId: 'brokerage'});
    const input = within(editor).getByLabelText('Effective annual account return (%)');
    setField(editor, 'Effective annual account return (%)', '1.234');
    await waitFor(() => expect(editor.querySelector('[data-preview-status]')).toHaveAttribute('data-preview-status', 'invalid'));
    fireEvent.focusOut(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const slider = within(editor).getByRole('slider');
    expect(slider).toHaveAttribute('aria-invalid', 'true');
    expect(slider).toHaveAccessibleDescription(/up to 2 decimal places/);
  });
  it.each(['0.00','123.45','','1.234'])('restores current basis text %j after reversing Unknown',raw=>{
    const base=makeAllocationPlan(),source={...base,accounts:base.accounts.map(account=>account.id==='brokerage'?{...account,openingTaxableBasis:{known:true as const,value:0}}:account)};
    const {root,controller}=mountWorkspace(source),editor=openRecord(root,{kind:'record',section:'accounts',recordId:'brokerage'});
    const history='Investment cost basis at forecast start ($) history',value='Investment cost basis at forecast start ($) value';
    setField(editor,value,raw);setField(editor,history,'unknown');
    const candidate=prepareEdit(controller,{kind:'record',section:'accounts',recordId:'brokerage'});
    expect(candidate.status).toBe('ready');if(candidate.status!=='ready')throw Error('Unknown candidate required');
    expect(candidate.plan.accounts.find(account=>account.id==='brokerage')!.openingTaxableBasis).toEqual({known:false});
    setField(editor,history,'known');expect(within(editor).getByLabelText(value)).toHaveValue(raw);
    expect(controller.getState().savedPlan.revision).toBe(0);
  });
  it('starts contributions for an applied account as a separate unapplied record', () => {
    const {root, controller} = mountWorkspace(makeAllocationPlan());
    const editor = openRecord(root, {kind: 'record', section: 'accounts', recordId: 'brokerage'});
    fireEvent.click(within(editor).getByRole('button', {name: 'Add contributions'}));
    const contribution = root.querySelector<HTMLElement>('[data-active-editor]')!;
    expect(within(contribution).getByLabelText('Contribution account')).toHaveValue('brokerage');
    expect(controller.getState().savedPlan.contributions).toHaveLength(0);
    expect(controller.getState().savedPlan.revision).toBe(0);
  });
  it('restores brokerage facts after reversing an RSU mode change', () => {
    const {root, controller} = mountWorkspace(makeAllocationPlan());
    const editor = openRecord(root, {kind: 'record', section: 'accounts', recordId: 'brokerage'});
    const before = structuredClone(controller.getDraft('accounts', 'brokerage').value);
    setField(editor, 'Account type', 'rsu');
    setField(editor, 'Account type', 'taxable-brokerage');
    expect(controller.getDraft('accounts', 'brokerage').value).toEqual(before);
    expect(controller.getState().savedPlan.revision).toBe(0);
  });

  it('labels the opening balance date and keeps basis separate from balance', () => {
    const {root} = mountWorkspace(makeAllocationPlan());
    const editor = openRecord(root, {kind: 'record', section: 'accounts', recordId: 'brokerage'});
    expect(within(editor).getByLabelText('Account opening balance ($)')).toHaveAccessibleDescription('Balance on January 1, 2026.');
    expect(within(editor).getByText(/Investment cost basis/)).toBeDefined();
  });

  it('restores an unfinished fixed contribution after reversing amount modes', () => {
    const plan = makeAllocationPlan({contributions: [{id: 'deposit', accountId: 'brokerage', priority: 1, startDate: '2026-01-01', amount: {kind: 'fixed', monthlyCents: 12345}}]});
    const {root, controller} = mountWorkspace(plan);
    const editor = openRecord(root, {kind: 'record', section: 'contributions', recordId: 'deposit'});
    setField(editor, 'Monthly contribution ($)', '1.234');
    setField(editor, 'Contribution amount mode', 'salary-percent');
    setField(editor, 'Contribution amount mode', 'fixed');
    expect(within(editor).getByLabelText('Monthly contribution ($)')).toHaveValue('1.234');
    expect(controller.getState().savedPlan.contributions[0]!.amount).toEqual({kind: 'fixed', monthlyCents: 12345});
  });
});
