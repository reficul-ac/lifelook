import type {ValidatedPlan} from './model/plan';
import type {RuleSet} from './rules/types';
import {projectWithCheckpoints} from './forecast/step-year';
export type * from './projection-types';
export {allocateAnnualTax} from './cash/tax-timing';
export function calculateProjection(inputs:ValidatedPlan,ruleSet:RuleSet){return projectWithCheckpoints(inputs,ruleSet).projection;}
