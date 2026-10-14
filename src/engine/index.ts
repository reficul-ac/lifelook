/** Browser consumers use this boundary; engine calculations have no browser dependencies. */
export { calculateProjection, allocateAnnualTax } from './projection';
export { summarizeYear, summarizeProjectionYear } from './reporting';
export { createPlan, validatePlan } from './validation';
export { loadRuleSet } from './rules/registry';
export { childCostBands, CHILD_PLANNING_MODEL_VERSION } from './rules/child-planning-v1';
export type { ChildCostBand } from './rules/child-planning-v1';
export { initializePurchaseLoan, defaultRentalAllocation } from './property/input-defaults';
export { rsuVestingEvents, projectRsuAccounts } from './equity/rsu';
export type * from './equity/rsu';
export type { PurchaseLoanInput } from './property/input-defaults';
export type * from './model/plan';
export type * from './model/results';
export type * from './model/tax-state';
export type * from './rules/types';
export type * from './projection-types';
export type * from './property/facts';
export type * from './tax/facts';
export type * from './tax/workplace';
export type * from './tax/payroll';
export type * from './tax/rental-losses';
export type * from './tax/ira';
export type * from './tax/itemized';
export type * from './tax/federal';
export type * from './tax/california';
export type * from './tax/comparison';
export type * from './cash/allocation-types';

export { getAduProjects, findAduOwner } from './property/adu-ownership';

export { calculateAduValueAdded, aduAreaRatios } from './property/adu-valuation';
export { calculateAduDepreciation } from './property/adu-depreciation';
export type { AduDepreciationYear } from './property/adu-depreciation';
export { ADU_PLANNING_MODEL_VERSION, maxAssessmentGrowthBps, aduPlanningProvenance } from './rules/adu-planning-v1';
