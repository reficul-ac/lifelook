import type {ValidatedPlan} from '../model/plan';
import type {RuleSet} from '../rules/types';
import {resolveAduPlanningEstimates} from '../property/adu-planning-estimates';
import {resolvePurchasePlanningEstimates} from '../property/purchase-planning-estimates';
import type {ForecastContext} from './types';
export function createForecastContext(source:ValidatedPlan,rules:RuleSet):ForecastContext {
 return Object.freeze({source,rules,plan:resolveAduPlanningEstimates(resolvePurchasePlanningEstimates(source)),sourceBinding:JSON.stringify(source),ruleBinding:JSON.stringify(rules)});
}
