import type { CashFlowAllocationPolicy, PlanDocument } from '../../src/engine/model/plan';
import { makePlan, mustValidate } from './plans';

export function makeAllocationPolicy(overrides: Partial<CashFlowAllocationPolicy> = {}): CashFlowAllocationPolicy {
  return { id: 'synthetic-allocation', entries: [], overflow: { id: 'synthetic-overflow', destination: { kind: 'cash' } }, ...overrides };
}

/** Synthetic accounts, zero growth, and explicitly answered history. */
export function makeAllocationPlan(overrides: Partial<PlanDocument> = {}): PlanDocument {
  const base = mustValidate(makePlan({
    salaries: ['salary-a', 'salary-b'].map((id, index) => ({ id, name: id, ownerId: index ? 'owner-b' : 'owner-a', employerId: `employer-${index}`, annualGrossCents: 10000000, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] })),
    accounts: [
      { id: 'brokerage', name: 'Stocks', ownerId: 'owner-a', type: 'taxable-brokerage', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: true, value: 0 } },
      { id: 'ira', name: 'IRA', ownerId: 'owner-a', type: 'traditional-ira', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: true, value: 0 } },
      { id: 'workplace', name: '401k', ownerId: 'owner-a', type: 'traditional-401k', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: true, value: 0 } },
    ],
  }));
  return { ...base, cashFlowAllocation: makeAllocationPolicy(), ...overrides };
}
