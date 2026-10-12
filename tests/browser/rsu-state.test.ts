import { describe, expect, it } from 'vitest';
import { createWorkspace, fromDraftValue, toDraftValue } from '../../src/browser/state';
import { exportPlan, loadPlan, PLAN_STORAGE_KEY, restorePlan, savePlan } from '../../src/browser/storage';
import type { Account } from '../../src/engine/model/plan';
import { makePlan } from '../helpers/plans';

const account: Account = {
  id: 'rsu-account', name: 'Employer equity', ownerId: 'owner-a', type: 'rsu', openingBalanceCents: 0,
  annualGrowthBps: 525, openingIraBasis: { known: false }, rsu: {
    employerId: 'employer-a', currentSharePriceCents: 15025,
    grants: [{ id: 'grant-a', name: 'Initial grant', startDate: '2025-01-01', grantValueCents: 1000000, grantSharePriceCents: 10025,
      awardedShares: 99.750623, vestingMonths: 48, vestingFrequency: 'monthly', cliffMonths: 0, withholdingBps: 3500,
      taxTreatment: 'settle-at-vest', openingHeldShares: 10.123456, openingBasis: { known: true, value: 12345 } }],
  },
};
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

describe('RSU nested drafts and compatible JSON backups', () => {
  it('round-trips share quantities without treating them as money and converts opening basis to dollars', () => {
    const draft = toDraftValue(account);
    expect(draft.rsu.grants[0]).toMatchObject({ awardedShares: '99.750623', openingHeldShares: '10.123456', vestingMonths: '48', cliffMonths: '0', withholdingBps: '35.00', openingBasis: { known: true, value: '123.45' } });
    expect(draft.rsu.currentSharePriceCents).toBe('150.25');
    expect(fromDraftValue(draft, account.id)).toEqual({ value: account, issues: [] });
  });
  it('keeps explicit unknown opening basis during draft conversion', () => {
    expect(fromDraftValue(toDraftValue({ openingBasis: { known: false } }), account.id)).toEqual({ value: { openingBasis: { known: false } }, issues: [] });
  });
  it.each(['', '1e3', '1,000', '1.1234567', 'Infinity'])('rejects a share entry %s with its indexed field path', openingHeldShares => {
    const draft = toDraftValue(account); draft.rsu.grants[0].openingHeldShares = openingHeldShares;
    expect(fromDraftValue(draft, account.id).issues).toContainEqual(expect.objectContaining({ recordId: account.id, field: 'rsu.grants.0.openingHeldShares', severity: 'error' }));
  });
  it('requires whole vesting and cliff month counts', () => {
    const draft = toDraftValue(account); draft.rsu.grants[0].vestingMonths = '12.5'; draft.rsu.grants[0].cliffMonths = '';
    expect(fromDraftValue(draft, account.id).issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'rsu.grants.0.vestingMonths' }), expect.objectContaining({ field: 'rsu.grants.0.cliffMonths' })]));
  });
  it('defaults new contribution rules to a saved cash account rather than the first RSU account', () => {
    const ordinary: Account = { id: 'broker', name: 'Broker', ownerId: 'owner-b', type: 'taxable-brokerage', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false } };
    const controller = createWorkspace(makePlan({ accounts: [account, ordinary] }), storage());
    const id = controller.beginAdd('contributions');
    expect(controller.getDraft('contributions', id).value.accountId).toBe(ordinary.id);
  });
  it('saves and restores nested RSU inputs at the existing version and storage key', () => {
    const port = storage(), plan = makePlan({ accounts: [account] });
    expect(savePlan(port, plan).persisted).toBe(true);
    expect(JSON.parse(port.getItem(PLAN_STORAGE_KEY)!)).toEqual(plan);
    const loaded = loadPlan(port); expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') throw new Error(JSON.stringify(loaded));
    expect(loaded.plan.accounts[0]?.rsu).toEqual(account.rsu);
    const restored = restorePlan(exportPlan(loaded.plan), makePlan(), storage());
    expect(restored.accepted).toBe(true); expect(restored.plan).toEqual(plan);
  });
  it('continues to restore an old ordinary-account backup without RSU fields', () => {
    const plan = makePlan({ accounts: [{ id: 'broker', name: 'Broker', ownerId: 'owner-a', type: 'taxable-brokerage', openingBalanceCents: 12345, annualGrowthBps: 500, openingIraBasis: { known: false } }] });
    const restored = restorePlan(exportPlan(plan), makePlan(), storage());
    expect(restored.accepted).toBe(true); expect(restored.plan).toEqual(plan);
    expect(restored.plan.schemaVersion).toBe(1);
  });
  it('retains current inputs and storage when an imported nested grant is invalid', () => {
    const port = storage(), current = makePlan(); savePlan(port, current);
    const invalid = { ...account, rsu: { ...account.rsu!, grants: [{ ...account.rsu!.grants[0]!, grantSharePriceCents: 0 }] } };
    const restored = restorePlan(exportPlan(makePlan({ accounts: [invalid] })), current, port);
    expect(restored.accepted).toBe(false); expect(restored.plan).toBe(current);
    expect(JSON.parse(port.getItem(PLAN_STORAGE_KEY)!)).toEqual(current);
    expect(restored.issues).toContainEqual(expect.objectContaining({ recordId: account.id, field: 'rsu.grants[0].grantSharePriceCents' }));
  });
});
