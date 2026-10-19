import {describe, expect, it, vi} from 'vitest';
import {fireEvent, within} from '@testing-library/dom';
import {mountNumericControl, normalizeNumericText} from '../../src/browser/ui/numeric-control';
import {mountAnniversaryControl} from '../../src/browser/ui/anniversary-control';
import {parseMoneyInput, parseRateInput} from '../../src/browser/input-parsers';

function host() { const root = document.createElement('div'); document.body.append(root); return root; }

describe('precise money and rate controls', () => {
  it('preserves malformed grouping and out-of-range exact values', () => {
    expect(normalizeNumericText('1,234.50', 'money')).toBe('1234.50');
    expect(normalizeNumericText('1,23', 'money')).toBe('1,23');
    expect(normalizeNumericText('-', 'money')).toBe('-');
    const root = host(), onInput = vi.fn();
    const control = mountNumericControl(root, {
      label: 'Expected return (%)', field: 'annualGrowthBps', kind: 'rate', raw: '25.00',
      slider: {minUnits: -1000, maxUnits: 2000, stepUnits: 25}, onInput, onCommit: () => {},
    });
    expect(control.input.value).toBe('25.00');
    expect(onInput).not.toHaveBeenCalled();
    expect(within(root).getByRole('slider')).toHaveValue('2000');
    control.update('-25.00');
    expect(control.input.value).toBe('-25.00');
    expect(within(root).getByRole('slider')).toHaveValue('-1000');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('converts valid pasted grouping through the shared parser without rounding', () => {
    const root = host(), onInput = vi.fn();
    const control = mountNumericControl(root, {label: 'Amount ($)', field: 'amountCents', kind: 'money', raw: '', onInput, onCommit: () => {}});
    fireEvent.input(control.input, {target: {value: '1,234.50'}});
    expect(onInput).toHaveBeenLastCalledWith('1234.50');
    expect(parseMoneyInput(onInput.mock.lastCall![0])).toEqual({status: 'available', value: 123450});
    fireEvent.input(control.input, {target: {value: '1,23'}});
    expect(onInput).toHaveBeenLastCalledWith('1,23');
    expect(parseMoneyInput(onInput.mock.lastCall![0]).status).toBe('needs-data');
    for (const value of ['1,234.567', '12,34,567', '1,234.', '--1,234.50', '1,,234.50', '1e3']) {
      expect(normalizeNumericText(value, 'money')).toBe(value);
    }
  });

  it('preserves focused partial text and selection when updating its model value', () => {
    const root = host();
    const control = mountNumericControl(root, {label: 'Amount ($)', field: 'amountCents', kind: 'money', raw: '1234.50', onInput: () => {}, onCommit: () => {}});
    control.input.focus();
    fireEvent.input(control.input, {target: {value: '-'}});
    control.input.setSelectionRange(1, 1);
    control.update('1234.50');
    expect(document.activeElement).toBe(control.input);
    expect(control.input.value).toBe('-');
    expect(control.input.selectionStart).toBe(1);
    expect(control.input.selectionEnd).toBe(1);
    control.input.blur();
    control.update('5.25');
    expect(control.input.value).toBe('5.25');
  });

  it('keeps negative rates and blank unknown input distinct from zero', () => {
    const root = host(), onInput = vi.fn();
    const control = mountNumericControl(root, {label: 'Effective return (%)', field: 'annualGrowthBps', kind: 'rate', raw: '', onInput, onCommit: () => {}});
    fireEvent.input(control.input, {target: {value: '-5.25'}});
    expect(onInput).toHaveBeenLastCalledWith('-5.25');
    expect(parseRateInput(onInput.mock.lastCall![0])).toEqual({status: 'available', value: -525});
    fireEvent.input(control.input, {target: {value: ''}});
    expect(onInput).toHaveBeenLastCalledWith('');
    expect(parseRateInput('').status).toBe('needs-data');
  });

  it('provides associated labels for exact entry and its supplemental slider', () => {
    const root = host();
    const control = mountNumericControl(root, {label: 'Expected return (%)', field: 'annualGrowthBps', kind: 'rate', raw: '5.00', slider: {minUnits: -1000, maxUnits: 2000, stepUnits: 25}, onInput: () => {}, onCommit: () => {}});
    expect(within(root).getByLabelText('Expected return (%)')).toBe(control.input);
    expect(control.input).toHaveAttribute('data-field', 'annualGrowthBps');
    expect(within(root).getByRole('slider')).toHaveAccessibleName('Expected return (%) adjustment');
  });

  it('steps slider arrow keys in exact units and flushes committed changes', () => {
    const root = host(), onInput = vi.fn(), onCommit = vi.fn(), commits = vi.fn();
    root.addEventListener('financial-input-commit', commits);
    const control = mountNumericControl(root, {label: 'Expected return (%)', field: 'annualGrowthBps', kind: 'rate', raw: '-5.25', slider: {minUnits: -1000, maxUnits: 2000, stepUnits: 25}, onInput, onCommit});
    const range = within(root).getByRole('slider');
    fireEvent.keyDown(range, {key: 'ArrowRight'});
    expect(onInput).toHaveBeenLastCalledWith('-5.00');
    expect(control.input).toHaveValue('-5.00');
    fireEvent.keyUp(range, {key: 'ArrowRight'});
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledTimes(1);
    fireEvent.input(range, {target: {value: '725'}});
    expect(onInput).toHaveBeenLastCalledWith('7.25');
    fireEvent.change(range);
    expect(onCommit).toHaveBeenCalledTimes(2);
    fireEvent.blur(control.input);
    expect(onCommit).toHaveBeenCalledTimes(3);
    expect(commits).toHaveBeenCalledTimes(3);
  });

  it('disposes input and commit listeners without removing unrelated controls', () => {
    const root = host(), onInput = vi.fn(), onCommit = vi.fn();
    const control = mountNumericControl(root, {label: 'Amount', field: 'amountCents', kind: 'money', raw: '1.00', onInput, onCommit});
    control.dispose();
    fireEvent.input(control.input, {target: {value: '2.00'}});
    fireEvent.blur(control.input);
    expect(onInput).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('readable raise anniversaries', () => {
  it('maps February and day 31 without silently changing the anniversary', () => {
    const root = host(), onChange = vi.fn();
    const control = mountAnniversaryControl(root, {month: '1', day: '31', onChange});
    const month = within(root).getByLabelText('Raise month'), day = within(root).getByLabelText('Raise day');
    fireEvent.change(month, {target: {value: '2'}});
    expect(onChange).toHaveBeenLastCalledWith('2', '31');
    expect(day).toHaveValue('31');
    expect(day).toHaveAccessibleDescription('Shorter months use their last day.');
    control.update('2', '31');
    expect(month).toHaveValue('2');
    expect(day).toHaveValue('31');
  });

  it('preserves unknown and malformed day entry until the owning record validates', () => {
    const root = host(), onChange = vi.fn(), commits = vi.fn();
    root.addEventListener('financial-input-commit', commits);
    const control = mountAnniversaryControl(root, {month: '', day: '', onChange});
    const month = within(root).getByLabelText('Raise month'), day = within(root).getByLabelText('Raise day');
    expect(month).toHaveValue(''); expect(day).toHaveValue('');
    fireEvent.input(day, {target: {value: '-'}});
    expect(onChange).toHaveBeenLastCalledWith('', '-');
    fireEvent.blur(day);
    expect(commits).toHaveBeenCalledTimes(1);
    control.dispose();
    fireEvent.change(month, {target: {value: '4'}});
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
