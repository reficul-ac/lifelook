import {prepareRetirementAnalysis,calculateRetirementComparison,calculateRetirementDetails,loadRuleSet} from '../../src/engine';
import type {RetirementReportSnapshot} from '../../src/browser/retirement-report-model';
import type {RetirementViewSelection} from '../../src/browser/retirement-state';
import type {RetirementRequestOwner} from '../../src/browser/retirement-analysis';
import {makeRetirementPlan,makeRetirementDefinition,makeRetirementTarget} from './retirement';
const fixtures=new Map<string,{report:RetirementReportSnapshot;selection:RetirementViewSelection}>();
export function retirementReportFixture(mode:'projected'|'reallocate'='reallocate',openingCashCents=0){
 const key=`${mode}:${openingCashCents}`;if(!fixtures.has(key)){
  const sourcePlan=makeRetirementPlan({startYear:2099,horizonYears:2,openingCashCents}),definition=makeRetirementDefinition(mode==='projected'?{}:{mode:'reallocate',stockGrowthBps:0,newProperties:[makeRetirementTarget({id:'home',name:'Retirement home',use:'personal',annualOperatingCostsCents:0,financing:{kind:'mortgage',downPaymentBps:2000,aprBps:0,termMonths:360}})]},sourcePlan),rules=loadRuleSet(),context=prepareRetirementAnalysis(sourcePlan,rules,definition);if(context.status!=='available')throw Error('context');
  const comparison=calculateRetirementComparison(context.value),candidate=comparison.candidates[0]!,detail=calculateRetirementDetails(context.value,2099,candidate.strategyId),owner:RetirementRequestOwner={workspaceGeneration:1,scenarioId:'master',sessionGeneration:1,activationGeneration:1,sourceBinding:JSON.stringify(sourcePlan),candidateBinding:JSON.stringify(sourcePlan),inputRevision:sourcePlan.revision,definitionFingerprint:JSON.stringify(definition),definitionGeneration:0,ruleVersion:rules.version,ruleBinding:JSON.stringify(rules),requestGeneration:1,detailGeneration:1};
  fixtures.set(key,{report:{sourcePlan,definition,status:'calculated',comparison,detail,owner},selection:{candidateYear:2099,calendarYear:2099,candidateHorizon:'all',showProjectedComparison:true,pathMetric:'after-tax-income'}});
 }
 const value=fixtures.get(key)!;return {report:{...value.report},selection:{...value.selection}};
}
