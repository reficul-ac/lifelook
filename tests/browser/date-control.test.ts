import {describe, expect, it, vi} from 'vitest';
import {fireEvent, within} from '@testing-library/dom';
import {mountDateControl} from '../../src/browser/ui/date-control';

function host() { const root = document.createElement('div'); document.body.append(root); return root; }

describe('native ISO date and month controls', () => {
  it.each([
    ['date', '2028-02-29', 'YYYY-MM-DD'],
    ['month', '2028-02', 'YYYY-MM'],
  ] as const)('keeps the exact %s value and its accessible format guidance', (kind, raw, guidance) => {
    const root = host(), onInput = vi.fn(), onCommit = vi.fn();
    const control = mountDateControl(root, {label: 'Effective date', field: 'effectiveDate', kind, raw, onInput, onCommit});
    expect(control.input.type).toBe(kind);
    expect(control.input.value).toBe(raw);
    expect(within(root).getByLabelText('Effective date')).toBe(control.input);
    expect(control.input).toHaveAccessibleDescription(guidance);
    expect(control.input).toHaveAttribute('data-field', 'effectiveDate');
    expect(control.input.name).toBe('effectiveDate');
    expect(onInput).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('forwards direct entry and commits once after the latest ISO input', async () => {
    const root = host(), onInput = vi.fn(), onCommit = vi.fn(), commits = vi.fn();
    root.addEventListener('financial-input-commit', commits);
    const control = mountDateControl(root, {label: 'Purchase date', field: 'purchaseDate', kind: 'date', raw: '2026-01-01', onInput, onCommit});
    fireEvent.input(control.input, {target: {value: '2026-01-02'}});
    expect(onInput).toHaveBeenLastCalledWith('2026-01-02');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(control.input);
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledTimes(1);
    fireEvent.blur(control.input);
    await Promise.resolve();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(commits).toHaveBeenCalledTimes(1);
  });

  it('publishes native calendar changes even when the browser emits no preceding input', () => {
    const root = host(), events: string[] = [];
    root.addEventListener('financial-input-commit', () => events.push('flush'));
    const control = mountDateControl(root, {label: 'Completion date', field: 'completionDate', kind: 'date', raw: '2028-02-28', onInput: raw => events.push(raw), onCommit: () => events.push('commit')});
    fireEvent.change(control.input, {target: {value: '2028-02-29'}});
    expect(events).toEqual(['2028-02-29', 'commit', 'flush']);
  });

  it('flushes an edited blur after DOM updates and ignores an unchanged blur', async () => {
    const root = host(), onCommit = vi.fn();
    const control = mountDateControl(root, {label: 'Payment month', field: 'paymentMonth', kind: 'month', raw: '2028-01', onInput: () => {}, onCommit});
    fireEvent.blur(control.input);
    await Promise.resolve();
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.input(control.input, {target: {value: '2028-02'}});
    fireEvent.blur(control.input);
    expect(onCommit).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('leaves unfinished native segments alone while focused and exposes only their empty native value', () => {
    const root = host(), onInput = vi.fn(), onCommit = vi.fn();
    const control = mountDateControl(root, {label: 'Purchase date', field: 'purchaseDate', kind: 'date', raw: '2028-02-29', onInput, onCommit});
    control.input.focus();
    fireEvent.input(control.input, {target: {value: ''}});
    control.update('2028-02-29');
    expect(control.input).toHaveFocus();
    expect(within(root).getByLabelText('Purchase date')).toBe(control.input);
    expect(control.input.value).toBe('');
    expect(onInput).toHaveBeenCalledExactlyOnceWith('');
    expect(onCommit).not.toHaveBeenCalled();
    control.input.blur();
    control.update('2028-03-31');
    expect(control.input.value).toBe('2028-03-31');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('updates unfocused values without committing the passive update', async () => {
    const root = host(), onInput = vi.fn(), onCommit = vi.fn();
    const control = mountDateControl(root, {label: 'Lease date', field: 'rentStartDate', kind: 'date', raw: '2028-01-31', onInput, onCommit});
    control.update('2028-02-29');
    expect(control.input.value).toBe('2028-02-29');
    fireEvent.blur(control.input);
    await Promise.resolve();
    expect(onInput).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each(['dispose', 'remove'] as const)('cancels a deferred blur when controls %s', async action => {
    const root = host(), onInput = vi.fn(), onCommit = vi.fn(), commits = vi.fn();
    root.addEventListener('financial-input-commit', commits);
    const control = mountDateControl(root, {label: 'Lease date', field: 'rentStartDate', kind: 'date', raw: '2028-01-31', onInput, onCommit});
    fireEvent.input(control.input, {target: {value: '2028-02-29'}});
    fireEvent.blur(control.input);
    if (action === 'dispose') control.dispose(); else root.replaceChildren();
    await Promise.resolve();
    fireEvent.change(control.input, {target: {value: '2028-03-31'}});
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(commits).not.toHaveBeenCalled();
  });
});
