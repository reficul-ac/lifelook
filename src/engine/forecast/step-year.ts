import type {ValidatedPlan} from '../model/plan';
import type {Issue,RuleProvenance} from '../model/results';
import type {RuleSet} from '../rules/types';
import type {ProjectionResult} from '../projection-types';
import {createForecastContext} from './context';
import {initializeForecast} from './checkpoint';
import {prepareForecastYear} from './prepare-year';
import {postForecastMonths} from './post-month';
import type {ForecastContext,ForecastCheckpoint,ForecastYearPolicy,ForecastYearStep,ForecastTrace} from './types';
export function stepForecastYear(context:ForecastContext,opening:ForecastCheckpoint,policy:ForecastYearPolicy):ForecastYearStep {
 if(opening.sourceBinding!==context.sourceBinding||opening.ruleBinding!==context.ruleBinding)throw new RangeError('Forecast checkpoint binding mismatch.');
 if(policy.kind==='working'&&(opening.year<context.source.startYear||opening.year>=context.source.startYear+context.source.horizonYears))throw new RangeError('Year is outside the validated working calendar.');
 if(policy.kind==='retired'&&(policy.year!==opening.year||opening.year<policy.calendar.startYear||opening.year>policy.calendar.endYear))throw new RangeError('Year is outside the validated retirement calendar.');
 return postForecastMonths(prepareForecastYear(policy.kind==='retired'?{...context,plan:policy.plan}:context,opening,policy));
}
const unique=<T>(values:readonly T[]):T[]=>[...new Map(values.map(v=>[JSON.stringify(v),v])).values()];
export function projectWithCheckpoints(source:ValidatedPlan,rules:RuleSet):ForecastTrace {
 const context=createForecastContext(source,rules),checkpoints=[initializeForecast(context)],steps:ProjectionResult[]=[];
 while(checkpoints.at(-1)!.year<source.startYear+source.horizonYears){const step=stepForecastYear(context,checkpoints.at(-1)!,{kind:'working'});steps.push(step.projection);checkpoints.push(step.closing);}
 const first=steps[0]!,issues=unique<Issue>(steps.flatMap(s=>s.issues));
 return {checkpoints,projection:{...first,months:steps.flatMap(s=>s.months),years:steps.flatMap(s=>s.years),contributions:steps.flatMap(s=>s.contributions),contributionSchedules:steps.flatMap(s=>s.contributionSchedules),taxStates:steps.flatMap(s=>s.taxStates),loanSchedules:steps.flatMap(s=>s.loanSchedules),cashSchedules:steps.flatMap(s=>s.cashSchedules),...(first.rsuSchedules?{rsuSchedules:steps.flatMap(s=>s.rsuSchedules??[])}:{}),closingTaxState:steps.at(-1)!.closingTaxState,provenance:unique<RuleProvenance>(steps.flatMap(s=>s.provenance)),issues,coverage:{completeForModeledScope:steps.every(s=>s.coverage.completeForModeledScope),completeHouseholdLiability:steps.every(s=>s.coverage.completeHouseholdLiability),issues:unique(steps.flatMap(s=>s.coverage.issues))}}};
}
