import type {PlanDocument, ValidatedPlan} from '../../src/engine/model/plan';
import {createDefaultRetirementAnalysis, type NewRetirementProperty, type RetirementAnalysisDefinition, type ValidatedRetirementAnalysis} from '../../src/engine/retirement/definition';
import {validateRetirementAnalysis} from '../../src/engine/retirement/validation';
import {makePlan, mustValidate} from './plans';
let targetId = 0;
export function makeRetirementPlan(overrides: Partial<PlanDocument> = {}): ValidatedPlan {
  const empty = makePlan();
  return mustValidate(makePlan({horizonYears: 2, household: {...empty.household, filers: empty.household.filers.map(f => ({...f, seniorDeductionSsnEligible: {known:true,value:true}})) as unknown as typeof empty.household.filers}, accounts: [{id:'stocks',name:'Synthetic stocks',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:100_000_000,openingTaxableBasis:{known:true,value:100_000_000},openingIraBasis:{known:true,value:0},annualGrowthBps:0}], ...overrides}));
}
export function makeRetirementDefinition(overrides: Partial<RetirementAnalysisDefinition> = {}, source: PlanDocument = makeRetirementPlan()): ValidatedRetirementAnalysis {
  const result = validateRetirementAnalysis({...createDefaultRetirementAnalysis(source), ...overrides}, source);
  if (!result.ok) throw Error(JSON.stringify(result.issues));
  return result.definition;
}
export function makeRetirementTarget(overrides: Partial<NewRetirementProperty> = {}): NewRetirementProperty {
  return {id:`target-${++targetId}`,name:'Synthetic rental',use:'rental',purchasePriceCents:60_000_000,appreciationBps:0,annualOperatingCostsCents:720_000,monthlyRentCents:280_000,vacancyBps:0,rentGrowthBps:0,financing:{kind:'cash'},...overrides};
}

import {createForecastContext} from '../../src/engine/forecast/context';
import {projectWithCheckpoints} from '../../src/engine/forecast/step-year';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {validateRetirementCalendar} from '../../src/engine/retirement/calendar';
import {createRetirementSnapshot,type RetirementSnapshot} from '../../src/engine/retirement/snapshot';
export function makeRetirementSnapshot(source:ValidatedPlan=makeRetirementPlan(),definition:ValidatedRetirementAnalysis=makeRetirementDefinition({},source),year:number=source.startYear):RetirementSnapshot {
 const rules=loadRuleSet(),context=createForecastContext(source,rules),calendar=validateRetirementCalendar(source,year);
 if(calendar.status!=='available')throw Error(JSON.stringify(calendar.issues));
 const opening=projectWithCheckpoints(source,rules).checkpoints.find(c=>c.year===year)!;
 const snapshot=createRetirementSnapshot(context,opening,definition,calendar.value);
 if(snapshot.status!=='available')throw Error(JSON.stringify(snapshot.issues));
 return snapshot.value;
}
