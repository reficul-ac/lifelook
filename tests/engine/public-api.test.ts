import { expect, it } from 'vitest';
import { calculateProjection, createPlan, loadRuleSet, validatePlan } from '../../src/engine/index';
import { makePlan } from '../helpers/plans';
import { makeAllocationPlan, makeAllocationPolicy } from '../helpers/allocations';

it('exposes the validated calculation boundary for an isolated consumer', () => {
  expect(createPlan('2026-10-12', 'new-plan').startYear).toBe(2027);
  const validation = validatePlan(makePlan({ revision: 4, openingCashCents: 10000 }));
  if (!validation.ok) throw new Error('Invalid synthetic input');
  const result = calculateProjection(validation.plan, loadRuleSet());
  expect(result.inputRevision).toBe(4);
  expect(result.years[0]).not.toHaveProperty('cashFlowAllocation');
  expect(result.years[0]?.netWorthCents).toEqual({ status: 'available', value: 10000 });
});

it('returns optional annual allocation reports through the unchanged validated boundary', () => {
  const document=makeAllocationPlan({revision:7,salaries:[],openingCashCents:12345,cashFlowAllocation:makeAllocationPolicy()});
  const validation=validatePlan(document);
  if(!validation.ok)throw new Error('Invalid allocation input');
  const result=calculateProjection(validation.plan,loadRuleSet());
  expect(result.inputRevision).toBe(7);
  expect(result.years[0]?.cashFlowAllocation).toMatchObject({status:'available',value:{status:'no-surplus',originalCashFlowCents:0,retainedCashCents:0}});
  expect(result.years[0]?.reserveCents).toEqual({status:'available',value:12345});
});
