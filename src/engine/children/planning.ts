import type { Cents, ChildPlan } from '../model/plan';
import { Decimal, settleCents } from '../money';
import { childCostBands } from '../rules/child-planning-v1';

/** Resolve any calendar year directly, preserving rounding anchored to each age's birthday. */
export function childExpenseAmounts(child: ChildPlan, year: number): readonly Cents[] {
  const birthYear = Number(child.birthMonth.slice(0,4));
  const birthMonth = Number(child.birthMonth.slice(5,7));
  const durationMonths = (child.includeAge18 ? 19 : 18) * 12;
  return Array.from({ length: 12 }, (_, index) => {
    const elapsed = (year - birthYear) * 12 + index + 1 - birthMonth;
    if (elapsed < 0 || elapsed >= durationMonths) return 0;
    const age = Math.floor(elapsed / 12);
    const budget = new Decimal(childCostBands.find(band => age >= band.startAge && age <= band.endAge)!.annualCents);
    const ageMonth = elapsed % 12;
    // Completed ages have integer annual totals, so their cumulative rounding remainder is zero.
    // Keep the current age's remainder even when its months span two forecast calendar years.
    return settleCents(budget.mul(ageMonth + 1).div(12)) - settleCents(budget.mul(ageMonth).div(12));
  });
}
