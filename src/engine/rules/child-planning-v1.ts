import type { Cents } from '../model/plan';
import type { RuleProvenance } from '../model/results';

/** Fixed planning assumptions supplied by the user, separate from sourced tax rules. */
export const CHILD_PLANNING_MODEL_VERSION = 'oceanside-child-planning.1';

export interface ChildCostBand {
  readonly label: string;
  readonly startAge: number;
  readonly endAge: number;
  readonly annualCents: Cents;
}

export const childCostBands: readonly ChildCostBand[] = Object.freeze([
  { label: 'Age 0', startAge: 0, endAge: 0, annualCents: 900000 },
  { label: 'Ages 1–2', startAge: 1, endAge: 2, annualCents: 800000 },
  { label: 'Ages 3–5', startAge: 3, endAge: 5, annualCents: 850000 },
  { label: 'Ages 6–8', startAge: 6, endAge: 8, annualCents: 1000000 },
  { label: 'Ages 9–11', startAge: 9, endAge: 11, annualCents: 1100000 },
  { label: 'Ages 12–14', startAge: 12, endAge: 14, annualCents: 1200000 },
  { label: 'Age 15', startAge: 15, endAge: 15, annualCents: 1250000 },
  { label: 'Ages 16–17', startAge: 16, endAge: 17, annualCents: 1600000 },
  { label: 'Age 18 (optional)', startAge: 18, endAge: 18, annualCents: 1600000 },
].map(band => Object.freeze(band)));

const assumptions = Object.freeze([
  'The explicit user-supplied Oceanside budget is a fixed planning model in today’s dollars, not a measured estimate of household spending.',
  'The budget excludes housing, medical, education and daycare costs; enter those separately as needed.',
  'The supplied dollar amounts are not inflated in later forecast years; no inflation or automatic annual growth is applied.',
  'Costs begin in the selected birth month; the age band changes in that same month each year and ends at the eighteenth birthday month, or the nineteenth when age 18 is included.',
  'Each annual age budget is divided across twelve birth-relative months with cumulative cent rounding; ages 0–17 total $194,000, or $210,000 including age 18.',
  'These are personal cash expenses only; child tax credits, dependent eligibility and additional tax deductions are not inferred.',
]);
const sources = Object.freeze(['User-supplied Oceanside child expense planning budget (2026-10-13).']);

export function childPlanningProvenance(year: number): RuleProvenance {
  return { status: 'projected', ruleVersion: CHILD_PLANNING_MODEL_VERSION, baselineYear: 2026,
    applicableYear: year, sources, assumptions };
}
