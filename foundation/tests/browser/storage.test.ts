import { describe, expect, it } from 'vitest';
import { exportPlan, loadPlan, PLAN_STORAGE_KEY, restorePlan, savePlan, type StoragePort } from '../../src/browser/storage';
import { createPlan } from '../../src/engine/validation';
import type { PlanDocument } from '../../src/engine/model/plan';
import { makePlan } from '../helpers/plans';
import { loadReferences } from '../helpers/references';

function memoryStorage() {
  const values = new Map<string, string>();
  let writes = 0;
  const port: StoragePort = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes++; values.set(key, value); },
  };
  return { port, values, writes: () => writes };
}
const fixture = loadReferences<PlanDocument, unknown>('projection').find(c => c.id === 'two-salaries-home-adu')!.input;
const badDocuments: readonly [string, (p: any) => void][] = [
  ['future schema', p => { p.schemaVersion = 2; }],
  ['duplicate identity', p => { p.accounts[1].id = p.accounts[0].id; }],
  ['dangling account', p => { p.contributions[0].accountId = 'missing'; }],
  ['unsafe money', p => { p.openingCashCents = Number.MAX_SAFE_INTEGER + 1; }],
  ['invalid nested loan', p => { p.properties[0].loans[0].aprBps = -1; }],
  ['unsupported enum', p => { p.accounts[0].type = 'crypto'; }],
];

describe('versioned atomic plan storage', () => {
  it('round-trips and rejects an invalid restore atomically', () => {
    const storage = memoryStorage(), current = makePlan({ revision: 3 });
    expect(savePlan(storage.port, current).persisted).toBe(true);
    expect(storage.values.has('lifelook.foundation.plan.v1')).toBe(true);
    expect(loadPlan(storage.port)).toMatchObject({ status: 'loaded', plan: current });
    const before = storage.values.get(PLAN_STORAGE_KEY);
    expect(restorePlan('{', current, storage.port)).toMatchObject({ accepted: false, plan: current });
    expect(storage.values.get(PLAN_STORAGE_KEY)).toBe(before);
    expect(storage.writes()).toBe(1);
    expect(loadPlan(storage.port)).toMatchObject({ status: 'loaded', plan: current });
    expect(JSON.parse(exportPlan(current))).toEqual(current);
  });
  it.each(badDocuments)('rejects %s before any replacement write', (_, mutate) => {
    const storage = memoryStorage(), current = makePlan({ revision: 7 });
    savePlan(storage.port, current);
    const raw = structuredClone(fixture); mutate(raw);
    const restored = restorePlan(JSON.stringify(raw), current, storage.port);
    expect(restored.accepted).toBe(false);
    expect(restored.plan).toBe(current);
    expect(restored.issues.length).toBeGreaterThan(0);
    expect(restored.issues.every(i => i.explanation && i.resolution)).toBe(true);
    expect(storage.writes()).toBe(1);
    expect(loadPlan(storage.port)).toMatchObject({ status: 'loaded', plan: current });
  });
  it('retains corrupt and future-version bytes for recovery without overwriting', () => {
    const storage = memoryStorage();
    for (const raw of ['{', JSON.stringify({ ...fixture, schemaVersion: 9 })]) {
      storage.values.set(PLAN_STORAGE_KEY, raw);
      expect(loadPlan(storage.port)).toMatchObject({ status: 'invalid', raw });
      expect(storage.values.get(PLAN_STORAGE_KEY)).toBe(raw);
    }
    expect(storage.writes()).toBe(0);
  });
  it('distinguishes a missing document from a storage read failure', () => {
    const storage = memoryStorage(); expect(loadPlan(storage.port)).toEqual({ status: 'missing' });
    const unreadable: StoragePort = { getItem: () => { throw new Error('Blocked'); }, setItem: () => {} };
    expect(loadPlan(unreadable)).toMatchObject({ status: 'read-failed', issues: [expect.objectContaining({ code: 'storage-read-failed' })] });
  });
  it('round-trips coverage-incomplete documents without inventing known zero history', () => {
    const storage = memoryStorage(), plan = createPlan('2026-10-12', 'new');
    expect(savePlan(storage.port, plan).persisted).toBe(true);
    const loaded = loadPlan(storage.port); if (loaded.status !== 'loaded') throw new Error('Not loaded');
    expect(loaded.plan).toEqual(plan);
    expect(loaded.plan.household.filers[0].birthDate).toEqual({ known: false });
    expect(JSON.parse(exportPlan(loaded.plan))).toEqual(plan);
  });
  it('retains a failed valid save as exportable in-memory data', () => {
    const attempted = makePlan({ revision: 8 });
    const full: StoragePort = { getItem: () => null, setItem: () => { throw new Error('Quota'); } };
    const saved = savePlan(full, attempted);
    expect(saved.persisted).toBe(false); expect(saved.plan).toEqual(attempted);
    expect(saved.issues).toContainEqual(expect.objectContaining({ code: 'storage-write-failed' }));
    expect(JSON.parse(exportPlan(saved.plan))).toEqual(attempted);
  });
  it('accepts a valid restore in memory despite a failed storage write', () => {
    const current = makePlan({ revision: 2 }), restored = makePlan({ revision: 9, openingCashCents: 12345 });
    const full: StoragePort = { getItem: () => JSON.stringify(current), setItem: () => { throw new Error('Quota'); } };
    const result = restorePlan(JSON.stringify(restored), current, full);
    expect(result).toMatchObject({ accepted: true, persisted: false, plan: restored });
    expect(JSON.parse(exportPlan(result.plan))).toEqual(restored);
    expect(loadPlan(full)).toMatchObject({ status: 'loaded', plan: current });
  });
  it('writes one complete restored document and preserves its input revision', () => {
    const storage = memoryStorage(), result = restorePlan(JSON.stringify(fixture), makePlan(), storage.port);
    expect(result).toMatchObject({ accepted: true, persisted: true, plan: fixture });
    expect(storage.writes()).toBe(1);
    expect(JSON.parse(storage.values.get(PLAN_STORAGE_KEY)!)).toEqual(fixture);
  });
});
