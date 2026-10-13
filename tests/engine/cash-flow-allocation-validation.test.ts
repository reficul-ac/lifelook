import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/engine/validation';
import { makeAllocationPlan, makeAllocationPolicy } from '../helpers/allocations';

const row = (destination: any = { kind: 'account', accountId: 'brokerage' }, amount: any = { kind: 'percent', percentBps: 5000 }, id = 'stocks-row') => ({ id, priority: 1, destination, amount });
function rejected(policy: any, field: string, mutate?: (plan: any) => void) {
  const plan = structuredClone(makeAllocationPlan({ cashFlowAllocation: policy }));
  mutate?.(plan);
  const result = validatePlan(plan);
  expect(result.ok).toBe(false);
  expect(result.issues).toContainEqual(expect.objectContaining({ field }));
}

describe('saved cash flow allocation validation', () => {
  it('accepts an empty policy and preserves its inputs', () => {
    const plan = makeAllocationPlan();
    expect(validatePlan(plan)).toMatchObject({ ok: true, plan });
  });
  it.each([0, 10000])('accepts the %i basis point boundary', percentBps => {
    const plan = makeAllocationPlan({ cashFlowAllocation: makeAllocationPolicy({ entries: [row(undefined, { kind: 'percent', percentBps })] }) });
    expect(validatePlan(plan).ok).toBe(true);
  });
  it.each([-1, 0.5, 10001])('rejects invalid percent %s at its nested path', percentBps => {
    rejected(makeAllocationPolicy({ entries: [row(undefined, { kind: 'percent', percentBps })] }), 'cashFlowAllocation.entries[0].amount.percentBps');
  });
  it('rejects percentage totals above 100%', () => {
    rejected(makeAllocationPolicy({ entries: [row(), { id: 'cash-row', priority: 2, destination: { kind: 'cash' }, amount: { kind: 'percent', percentBps: 5001 } }] }), 'cashFlowAllocation.entries');
  });
  it.each(['synthetic-plan', 'owner-a', 'brokerage', 'salary-a'])('rejects policy ID collision with %s', id => {
    rejected(makeAllocationPolicy({ id }), 'cashFlowAllocation.id');
  });
  it.each(['constructor', 'stocks-row'])('rejects duplicate nested ID %s safely', id => {
    rejected(makeAllocationPolicy({ entries: [row(undefined, undefined, id)], overflow: { id, destination: { kind: 'cash' } } }), 'cashFlowAllocation.overflow.id');
  });
  it('rejects a policy/entry ID collision', () => {
    rejected(makeAllocationPolicy({ entries: [row(undefined, undefined, 'synthetic-allocation')] }), 'cashFlowAllocation.entries[0].id');
  });
  it.each([{ kind: 'cash' }, { kind: 'account', accountId: 'brokerage' }])('rejects repeated primary destination %j', destination => {
    rejected(makeAllocationPolicy({ entries: [row(destination), row(destination, undefined, 'second-row')] }), 'cashFlowAllocation.entries[1].destination');
  });
  it.each([{ kind: 'cash' }, { kind: 'account', accountId: 'brokerage' }])('rejects annual maximum for %j', destination => {
    rejected(makeAllocationPolicy({ entries: [row(destination, { kind: 'max-annual' })] }), 'cashFlowAllocation.entries[0].amount.kind');
  });
  it.each(['traditional-401k', 'roth-401k', 'traditional-ira', 'roth-ira'])('accepts maximum and repeated overflow for %s', type => {
    const plan: any = structuredClone(makeAllocationPlan());
    plan.accounts[2].type = type;
    const destination = { kind: 'account' as const, accountId: 'workplace', ...(type.endsWith('401k') ? { sponsoringSalaryId: 'salary-a' } : {}) };
    plan.cashFlowAllocation = makeAllocationPolicy({ entries: [row(destination, { kind: 'max-annual' })], overflow: { id: 'synthetic-overflow', destination } });
    expect(validatePlan(plan).ok).toBe(true);
  });
  it.each([undefined, 'missing', 'salary-b'])('rejects missing, dangling or owner-mismatched sponsor %s', sponsoringSalaryId => {
    rejected(makeAllocationPolicy({ overflow: { id: 'synthetic-overflow', destination: { kind: 'account', accountId: 'workplace', ...(sponsoringSalaryId === undefined ? {} : { sponsoringSalaryId }) } } }), 'cashFlowAllocation.overflow.destination.sponsoringSalaryId');
  });
  it.each([{ kind: 'cash', sponsoringSalaryId: 'salary-a' }, { kind: 'account', accountId: 'ira', sponsoringSalaryId: 'salary-a' }])('rejects irrelevant sponsor %j', destination => {
    rejected(makeAllocationPolicy({ entries: [row(destination)] }), 'cashFlowAllocation.entries[0].destination.sponsoringSalaryId');
  });
  it('rejects conflicting primary and excess sponsors', () => {
    rejected(makeAllocationPolicy({ entries: [row({ kind: 'account', accountId: 'workplace', sponsoringSalaryId: 'salary-a' })], overflow: { id: 'synthetic-overflow', destination: { kind: 'account', accountId: 'workplace', sponsoringSalaryId: 'second-salary-a' } } }), 'cashFlowAllocation.overflow.destination.sponsoringSalaryId', plan => { plan.salaries.push({ ...plan.salaries[0], id: 'second-salary-a' }); });
  });
  it('blocks deletion of a referenced account', () => {
    rejected(makeAllocationPolicy({ entries: [row()] }), 'cashFlowAllocation.entries[0].destination.accountId', plan => { plan.accounts = plan.accounts.filter((a: any) => a.id !== 'brokerage'); });
  });
  it('blocks deletion of a referenced salary', () => {
    rejected(makeAllocationPolicy({ entries: [row({ kind: 'account', accountId: 'workplace', sponsoringSalaryId: 'salary-a' })] }), 'cashFlowAllocation.entries[0].destination.sponsoringSalaryId', plan => { plan.salaries = plan.salaries.filter((s: any) => s.id !== 'salary-a'); });
  });
  it('rejects accounts changed to RSU', () => {
    rejected(makeAllocationPolicy({ entries: [row()] }), 'cashFlowAllocation.entries[0].destination.accountId', plan => { plan.accounts[0] = { ...plan.accounts[0], type: 'rsu', openingIraBasis: { known: false }, rsu: { employerId: 'employer-0', currentSharePriceCents: 100, grants: [] } }; });
  });
  it.each([-1, 0.5])('rejects invalid priority %s', priority => {
    rejected(makeAllocationPolicy({ entries: [{ ...row(), priority }] }), 'cashFlowAllocation.entries[0].priority');
  });
  it.each([
    [null, 'cashFlowAllocation'],
    [{ id: 'policy', entries: {}, overflow: { id: 'overflow', destination: { kind: 'cash' } } }, 'cashFlowAllocation.entries'],
    [makeAllocationPolicy({ entries: [row({ kind: 'unknown' })] }), 'cashFlowAllocation.entries[0].destination.kind'],
    [makeAllocationPolicy({ entries: [row(undefined, { kind: 'fixed' })] }), 'cashFlowAllocation.entries[0].amount.kind'],
  ])('rejects malformed policy at %s', (policy, field) => rejected(policy, field as string));
});
