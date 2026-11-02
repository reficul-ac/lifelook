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
import {makeAduPlan,makeAduTreatments} from './adu';
export function makeDrawnRetirementAduSource(overrides:Partial<PlanDocument>={}):ValidatedPlan {
 const base=makeAduPlan({horizonYears:4,openingCashCents:0,accounts:makeRetirementPlan().accounts,...overrides},{completionDate:'2028-01-31',ownerFunding:{kind:'taxable-brokerage',accountId:'stocks'},costs:[{id:'stage',name:'Stage',paymentDate:'2028-01-15',amountCents:15_000_000,category:'building',treatments:makeAduTreatments(15_000_000)}],financing:{id:'construction-loan',name:'Construction loan',aprBps:0,firstAmortizingPaymentMonth:'2028-02',termMonths:120,collateralPropertyId:'home',draws:[{id:'advance',month:'2027-12',amountCents:10_000_000,costAllocations:[{costId:'stage',amountCents:10_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true}}});
 return mustValidate({...base,properties:base.properties.map(p=>({...p,aduProject:{...p.aduProject!,propertyTax:{...p.aduProject!.propertyTax,paymentYears:[2026,2027,2028,2029,2030].map(year=>({year,complete:{known:true as const,value:true},payments:[]}))}}})),rentals:base.rentals.map(r=>({...r,availableDate:'2028-02-01',rentStartDate:'2028-03-01'}))});
}
