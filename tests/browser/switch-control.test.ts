import {describe, expect, it, vi} from 'vitest';
import {fireEvent, within} from '@testing-library/dom';
import {mountSwitchControl} from '../../src/browser/ui/switch-control';

function host() { const root = document.createElement('div'); document.body.append(root); return root; }

describe('native binary switch control', () => {
  it('names a native checkbox and retains the mounted input through passive updates', () => {
    const root = host(), onChange = vi.fn();
    const control = mountSwitchControl(root, {label: 'Show applied plan', field: 'showComparison', checked: true, onChange});
    expect(control.input.type).toBe('checkbox');
    expect(control.input.getAttribute('role')).toBe('switch');
    expect(within(root).getByRole('switch', {name: 'Show applied plan', checked: true})).toBe(control.input);
    expect(within(root).getByLabelText('Show applied plan')).toBe(control.input);
    expect(control.input).toHaveAttribute('data-field', 'showComparison');
    expect(control.input.name).toBe('showComparison');
    control.input.focus();
    control.update(false);
    expect(within(root).getByRole('switch', {name: 'Show applied plan', checked: false})).toBe(control.input);
    expect(control.input).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('publishes a native activation before flushing its committed input', () => {
    const root = host(), changes: boolean[] = [], committed: boolean[][] = [];
    root.addEventListener('financial-input-commit', () => committed.push([...changes]));
    const control = mountSwitchControl(root, {label: 'Include full year at age 18', field: 'includeAge18', checked: false, onChange: checked => changes.push(checked)});
    fireEvent.click(control.input);
    expect(changes).toEqual([true]);
    expect(committed).toEqual([[true]]);
    fireEvent.click(within(root).getByText('Include full year at age 18'));
    expect(changes).toEqual([true, false]);
    expect(committed).toEqual([[true], [true, false]]);
  });

  it('makes detached switch handlers inert on disposal', () => {
    const root = host(), onChange = vi.fn(), commits = vi.fn();
    root.addEventListener('financial-input-commit', commits);
    const control = mountSwitchControl(root, {label: 'Show applied plan', field: 'showComparison', checked: true, onChange});
    control.dispose();
    fireEvent.click(control.input);
    control.update(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(commits).not.toHaveBeenCalled();
    expect(control.input.checked).toBe(false);
  });
});
