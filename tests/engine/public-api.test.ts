import { expect, it } from 'vitest';
import { calculateProjection, createPlan, loadRuleSet, validatePlan } from '../../src/engine/index';
import { makePlan } from '../helpers/plans';

it('exposes the validated calculation boundary for an isolated consumer', () => {
  expect(createPlan('2026-10-12', 'new-plan').startYear).toBe(2027);
  const validation = validatePlan(makePlan({ revision: 4, openingCashCents: 10000 }));
  if (!validation.ok) throw new Error('Invalid synthetic input');
  const result = calculateProjection(validation.plan, loadRuleSet());
  expect(result.inputRevision).toBe(4);
  expect(result.years[0]?.netWorthCents).toEqual({ status: 'available', value: 10000 });
});
