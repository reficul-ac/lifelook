import {describe, expect, it} from 'vitest';
import {fireEvent, waitFor, within} from '@testing-library/dom';
import {mountWorkspace, setField} from '../helpers/dom';
import {makeAllocationPlan} from '../helpers/allocations';
import {openRecord} from '../helpers/workspace-ui';

describe('account entry', () => {
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
