import {describe, expect, it, vi} from 'vitest';
import {fireEvent, within} from '@testing-library/dom';
import {renderIncomeForm} from '../../src/browser/forms/income';
import {createRecordEditorMemory} from '../../src/browser/record-ui-state';
import {createWorkspace} from '../../src/browser/state';
import {loadRuleSet} from '../../src/engine';
import {makeAllocationPlan} from '../helpers/allocations';

describe('focused record adapters', () => {
  it('mounts just the selected salary and delegates submission without applying', () => {
    const root = document.createElement('div'); document.body.replaceChildren(root);
    const controller = createWorkspace(makeAllocationPlan(), {getItem: () => null, setItem: () => {}}, loadRuleSet());
    const submit = vi.fn();
    renderIncomeForm(root, controller, undefined, {section: 'salaries', recordId: 'salary-a', memory: createRecordEditorMemory(), onSubmit: submit});
    expect(root.querySelectorAll('form')).toHaveLength(1);
    expect(root.querySelector('form')?.dataset.recordId).toBe('salary-a');
    expect(within(root).queryByRole('button', {name: /^Save/})).toBeNull();
    expect(within(root).queryByRole('button', {name: 'Add salary'})).toBeNull();
    fireEvent.submit(root.querySelector('form')!);
    expect(submit).toHaveBeenCalledOnce();
    expect(controller.getState().savedPlan.revision).toBe(0);
  });

  it('keeps standalone section adapters available', () => {
    const root = document.createElement('div');
    const controller = createWorkspace(makeAllocationPlan(), {getItem: () => null, setItem: () => {}}, loadRuleSet());
    renderIncomeForm(root, controller);
    expect(within(root).getAllByRole('button', {name: 'Save salary'})).toHaveLength(2);
    expect(within(root).getByRole('button', {name: 'Add salary'})).toBeDefined();
  });
});
