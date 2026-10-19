import {describe, expect, it} from 'vitest';
import {fireEvent, waitFor, within} from '@testing-library/dom';
import {mountWorkspace, setField} from '../helpers/dom';
import {makeAllocationPlan} from '../helpers/allocations';
import {openRecord, openCollection, waitForPreview} from '../helpers/workspace-ui';

describe('overview workspace', () => {
  it('ignores a detached Apply action after another record owns the preview', async () => {
    const {root, controller} = mountWorkspace(makeAllocationPlan());
    const first = openRecord(root, {kind: 'record', section: 'salaries', recordId: 'salary-a'});
    setField(first, 'Annual gross salary ($)', '125000.00'); await waitForPreview(root);
    const oldApply = within(first).getByRole('button', {name: 'Apply salary changes'});
    const second = openRecord(root, {kind: 'record', section: 'salaries', recordId: 'salary-b'});
    setField(second, 'Annual gross salary ($)', '130000.00'); await waitForPreview(root);
    fireEvent.click(oldApply);
    expect(controller.getState().savedPlan.revision).toBe(0);
    expect(controller.getState().savedPlan.salaries[1]!.annualGrossCents).toBe(10000000);
  });
  it('reviews current invalid inputs without clearing the errors or restarting preview', async () => {
    const {root} = mountWorkspace(makeAllocationPlan());
    const editor = openRecord(root, {kind: 'record', section: 'salaries', recordId: 'salary-a'});
    const input = within(editor).getByLabelText('Annual gross salary ($)');
    setField(editor, 'Annual gross salary ($)', '1.234');
    await waitFor(() => expect(editor.querySelector('[data-preview-status]')).toHaveAttribute('data-preview-status', 'invalid'));
    fireEvent.click(within(editor).getByRole('button', {name: 'Review inputs'}));
    expect(editor.querySelector('[data-preview-status]')).toHaveAttribute('data-preview-status', 'invalid');
    expect(input).toHaveAttribute('aria-invalid', 'true'); expect(input).toHaveFocus();
  });
  it('starts on a full overview and opens just one selected record from a compact collection', () => {
    const {root} = mountWorkspace(makeAllocationPlan());
    expect(root.querySelector('[data-active-editor]')).toBeNull();
    expect(within(root).getByRole('table', {name: 'Annual balance sheet'})).toBeVisible();
    const collection = openCollection(root, 'income');
    expect(collection.querySelector('form')).toBeNull();
    const editor = openRecord(root, {kind: 'record', section: 'salaries', recordId: 'salary-a'});
    expect(editor.querySelectorAll('form')).toHaveLength(1);
    expect(within(editor).getByLabelText('Annual gross salary ($)')).toHaveValue('100000.00');
    fireEvent.click(within(root).getByRole('button', {name: 'Close editor'}));
    expect(root.querySelector('[data-active-editor]')).toBeNull();
    expect(document.activeElement).toHaveTextContent('Edit');
  });

  it('previews one draft without persisting and applies the reviewed result once', async () => {
    const {root, controller} = mountWorkspace(makeAllocationPlan());
    const editor = openRecord(root, {kind: 'record', section: 'salaries', recordId: 'salary-a'});
    const input = within(editor).getByLabelText('Annual gross salary ($)');
    setField(editor, 'Annual gross salary ($)', '125000.00');
    await waitForPreview(root);
    expect(controller.getState().savedPlan.salaries[0]!.annualGrossCents).toBe(10000000);
    expect(input.isConnected).toBe(true);
    fireEvent.click(within(editor).getByRole('button', {name: 'Apply salary changes'}));
    expect(controller.getState().savedPlan.salaries[0]!.annualGrossCents).toBe(12500000);
    expect(controller.getState().projection.inputRevision).toBe(1);
    expect(input.isConnected).toBe(true);
  });

  it('retains raw fields and the editor node while switching Edit and Forecast', () => {
    const {root, controller} = mountWorkspace(makeAllocationPlan());
    const editor = openRecord(root, {kind: 'record', section: 'salaries', recordId: 'salary-a'});
    const input = within(editor).getByLabelText('Annual gross salary ($)');
    setField(editor, 'Annual gross salary ($)', '-');
    fireEvent.click(within(root).getByRole('button', {name: 'Forecast'}));
    fireEvent.click(within(root).getByRole('button', {name: 'Edit'}));
    expect(within(editor).getByLabelText('Annual gross salary ($)')).toBe(input);
    expect(input).toHaveValue('-');
    expect(controller.getState().savedPlan.revision).toBe(0);
  });

  it('adds an unapplied record and discards only that record', () => {
    const {root, controller} = mountWorkspace(makeAllocationPlan());
    openCollection(root, 'accounts');
    fireEvent.click(within(root).getByRole('button', {name: 'Add account'}));
    expect(controller.getState().savedPlan.accounts).toHaveLength(3);
    expect(root.querySelectorAll('[data-active-editor]')).toHaveLength(1);
    fireEvent.click(within(root.querySelector<HTMLElement>('[data-active-editor]')!).getByRole('button', {name: 'Discard edits'}));
    expect(Object.keys(controller.getState().drafts)).toHaveLength(0);
    expect(root.querySelector('[data-active-editor]')).toBeNull();
  });
});
