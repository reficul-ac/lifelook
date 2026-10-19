import {describe, expect, it} from 'vitest';
import {createRecordEditorMemory, swapMode} from '../../src/browser/record-ui-state';
import {renderEditorGroup, revealEditorField} from '../../src/browser/ui/editor-groups';

describe('record editor memory', () => {
  it('restores only the inactive mode subtree including invalid raw text and unknowns', () => {
    const memory = createRecordEditorMemory();
    const prior = {openingBalanceCents: '12.345', openingTaxableBasis: {known: false}};
    expect(swapMode(memory, 'account-type', 'brokerage', 'rsu', prior, {grants: []})).toEqual({grants: []});
    expect(swapMode(memory, 'account-type', 'rsu', 'brokerage', {grants: []}, {})).toEqual(prior);
    prior.openingBalanceCents = '0';
    expect(memory.modes.get('account-type:brokerage')?.openingBalanceCents).toBe('12.345');
  });

  it('reveals a mounted hidden step and disclosure before focusing its field', () => {
    const root = document.createElement('div'); document.body.replaceChildren(root);
    const memory = createRecordEditorMemory(); memory.step = 'basics';
    const group = renderEditorGroup(root, {id: 'history', label: 'Tax history', advanced: true, step: 'tax'}, memory, body => {
      const input = document.createElement('input'); input.dataset.field = 'basis.value'; body.append(input);
    });
    expect(group.hidden).toBe(true);
    expect(revealEditorField(root, ['basis', 'value'], memory)).toBe(true);
    expect(memory.step).toBe('tax'); expect(group.hidden).toBe(false);
    expect((group as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('input'));
  });
});
