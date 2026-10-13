import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../src/browser/state';
import { exportPlan, loadPlan, restorePlan, savePlan, PLAN_STORAGE_KEY } from '../../src/browser/storage';
import { makePlan } from '../helpers/plans';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, port: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } } };
}

describe('saved child plans', () => {
  it('adds, saves, edits and removes a child from a legacy plan', () => {
    const storage = memoryStorage(), controller = createWorkspace(makePlan(), storage.port);
    const id = controller.beginAdd('children');
    expect(controller.getDraft('children', id).value).toMatchObject({ id, birthMonth: '2026-01', includeAge18: false });
    const draft = controller.getDraft('children', id);
    controller.editDraft(id, { ...draft, value: { ...draft.value, name: 'Planned child', birthMonth: '2026-07' } });
    expect(controller.saveRecord(id).accepted).toBe(true);
    expect(controller.getState().savedPlan.children).toEqual([{ id, name: 'Planned child', birthMonth: '2026-07', includeAge18: false }]);
    expect(controller.getState().projection.months[5]!.expensesCents).toEqual({ status: 'available', value: 0 });
    expect(controller.getState().projection.months[6]!.expensesCents).toEqual({ status: 'available', value: 75000 });

    const saved = controller.getState().savedPlan, projection = controller.getState().projection;
    const edited = controller.getDraft('children', id);
    controller.editDraft(id, { ...edited, value: { ...edited.value, birthMonth: '' } });
    expect(controller.saveRecord(id).accepted).toBe(false);
    expect(controller.getState().savedPlan).toBe(saved);
    expect(controller.getState().projection).toBe(projection);
    expect(controller.getDraft('children', id).value.birthMonth).toBe('');
    controller.discardDraft(id);
    expect(controller.getDraft('children', id).value.birthMonth).toBe('2026-07');

    const renamed = controller.getDraft('children', id);
    controller.editDraft(id, { ...renamed, value: { ...renamed.value, name: 'Updated child', includeAge18: true } });
    expect(controller.saveRecord(id).accepted).toBe(true);
    expect(controller.getState().savedPlan.children![0]).toMatchObject({ name: 'Updated child', includeAge18: true });
    expect(controller.removeRecord('children', id).accepted).toBe(true);
    expect(controller.getState().savedPlan.children).toEqual([]);
    expect(controller.getState().projection.months[6]!.expensesCents).toEqual({ status: 'available', value: 0 });
  });
  it('round-trips child dates and options while rejecting an invalid backup atomically', () => {
    const storage = memoryStorage(), child = { id: 'child-a', name: 'Child', birthMonth: '2028-11', includeAge18: true };
    const plan = makePlan({ children: [child] });
    expect(savePlan(storage.port, plan).persisted).toBe(true);
    expect(loadPlan(storage.port)).toMatchObject({ status: 'loaded', plan: { children: [child] } });
    expect(JSON.parse(exportPlan(plan)).children).toEqual([child]);
    const before = storage.values.get(PLAN_STORAGE_KEY);
    const result = restorePlan(JSON.stringify({ ...plan, children: [{ ...child, birthMonth: '2028-99' }] }), plan, storage.port);
    expect(result.accepted).toBe(false);
    expect(result.plan).toBe(plan);
    expect(storage.values.get(PLAN_STORAGE_KEY)).toBe(before);
    expect(restorePlan(exportPlan(plan), makePlan(), storage.port)).toMatchObject({ accepted: true, plan: { children: [child] } });
  });
});
