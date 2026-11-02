import {expect,it} from 'vitest';
import {validateRetirementCalendar} from '../../src/engine/retirement/calendar';
import {createRetirementSnapshot,compileRetirementYearPolicy} from '../../src/engine/retirement/snapshot';
import {createForecastContext} from '../../src/engine/forecast/context';
import {projectWithCheckpoints,stepForecastYear} from '../../src/engine/forecast/step-year';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {validatePlan} from '../../src/engine/validation';
import {resolveAduYear} from '../../src/engine/property/adu-lifecycle';
import {resolveAduPlanningEstimates} from '../../src/engine/property/adu-planning-estimates';
import {resolveCashYear} from '../../src/engine/cash/income';
import {makeRetirementDefinition,makeRetirementPlan,makeRetirementSnapshot} from '../helpers/retirement';
import {makeFuturePurchasePlan} from '../helpers/future-purchase';
import {makeAduPlan} from '../helpers/adu';
const rules=loadRuleSet();
it('permits the retirement calendar without widening saved horizons',()=>{
 const source=makeRetirementPlan({startYear:2099,horizonYears:2});
 expect(validateRetirementCalendar(source,2099)).toMatchObject({status:'available',value:{startYear:2099,endYear:2100}});
 expect(validatePlan({...source,horizonYears:75}).ok).toBe(false);
 for(const year of [2098,2101,2099.5])expect(validateRetirementCalendar(source,year).status).not.toBe('available');
 let snapshot=makeRetirementSnapshot(source),opening=snapshot.opening;
 const months=[];
 for(let year=2099;year<=2100;year++){const step=stepForecastYear(snapshot.context,opening,compileRetirementYearPolicy(snapshot,year));months.push(...step.projection.months);opening=step.closing;}
 expect(months.at(-1)!.date).toBe('2100-12');expect(opening.year).toBe(2101);
 expect(()=>compileRetirementYearPolicy(snapshot,2101)).toThrow();
});
it('uses each candidate’s own untouched January cash and basis',()=>{
 const source=makeRetirementPlan({openingCashCents:500,contributions:[{id:'deposit',accountId:'stocks',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100}}]});
 const first=makeRetirementSnapshot(source),later=makeRetirementSnapshot(source,undefined,2027);
 expect(first.opening.reserve).toEqual({status:'available',value:500});
 expect(first.opening.brokerageBasis.stocks).toEqual({status:'available',value:100_000_000});
 expect(later.opening.reserve).toEqual({status:'available',value:-700});
 expect(later.opening.brokerageBasis.stocks).toEqual({status:'available',value:100_001_200});
 expect(later.opening.conditionalOnGap).toBe(true);
});
it('stops both wages, employment contributions and future service vesting without resetting dates',()=>{
 const source=makeRetirementPlan({salaries:['owner-a','owner-b'].map((ownerId,i)=>({id:`salary-${i}`,name:'Salary',ownerId,employerId:`employer-${i}`,annualGrossCents:8_000_000,startDate:'2020-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]})),otherIncome:[{id:'wage-other',name:'Other wage',classification:'wage',ownerId:'owner-b',employerId:'other-employer',amountCents:10000,frequency:'monthly',startDate:'2020-01-01',annualGrowthBps:0},{id:'nonwage',name:'Dated other',classification:'non-taxable',amountCents:10000,frequency:'monthly',startDate:'2027-03-01',endDate:'2027-04-30',annualGrowthBps:0}],expenses:[{id:'living',name:'Living',use:'personal',taxCategory:'personal',amountCents:10000,frequency:'monthly',startDate:'2020-01-01',annualGrowthBps:100}],children:[{id:'child',name:'Child',birthMonth:'2020-06',includeAge18:true}],accounts:[{id:'shares',name:'Shares',ownerId:'owner-a',type:'rsu',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false},rsu:{employerId:'employer-0',currentSharePriceCents:10000,grants:[{id:'grant',name:'Grant',startDate:'2025-01-01',grantValueCents:120000,grantSharePriceCents:10000,vestingMonths:36,vestingFrequency:'monthly',cliffMonths:0,withholdingBps:0,taxTreatment:'settle-at-vest',openingHeldShares:2,openingBasis:{known:true,value:20000}}]}},{id:'workplace',name:'Workplace',ownerId:'owner-a',type:'traditional-401k',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'employment-deposit',accountId:'workplace',sponsoringSalaryId:'salary-0',priority:1,startDate:'2020-01-01',amount:{kind:'fixed',monthlyCents:10000}}]});
 const before=JSON.stringify(source),snapshot=makeRetirementSnapshot(source),next=stepForecastYear(snapshot.context,snapshot.opening,compileRetirementYearPolicy(snapshot,2026)).closing,step=stepForecastYear(snapshot.context,next,compileRetirementYearPolicy(snapshot,2027));
 expect(step.projection.years[0]!.salaryCents).toEqual({status:'available',value:0});
 expect(step.projection.years[0]!.otherIncomeCents).toEqual({status:'available',value:20000});
 expect(step.projection.years[0]!.eligibleContributionCents).toEqual({status:'available',value:0});
 expect(step.projection.years[0]!.accounts[0]!.closingCents).toEqual({status:'available',value:20000});
 expect(step.projection.rsuSchedules![0]!.schedule).toMatchObject({status:'available',value:expect.arrayContaining([expect.objectContaining({vestedShares:0,heldShares:2})])});
 const expected=resolveCashYear(source,2027).streams.filter(s=>s.id==='living'||s.id==='child').sort((a,b)=>a.id.localeCompare(b.id));
 expect(step.projection.cashSchedules.filter(s=>s.kind==='expense').map(s=>s.schedule.status==='available'?s.schedule.value:undefined)).toEqual(expected);
 expect(JSON.stringify(source)).toBe(before);
});
it('keeps future commitments by default and explicitly excludes unstarted reallocation schedules',()=>{
 const source=makeRetirementPlan(makeFuturePurchasePlan());
 const projected=makeRetirementSnapshot(source);
 expect(projected.commitments).toContainEqual(expect.objectContaining({recordId:'future-home',action:'continue'}));
 const definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0},source),reallocated=makeRetirementSnapshot(source,definition);
 expect(reallocated.propertyStatuses).toContainEqual({propertyId:'future-home',status:'pending'});
 expect(reallocated.commitments).toContainEqual(expect.objectContaining({recordId:'future-home',action:'exclude'}));
 const next=stepForecastYear(reallocated.context,reallocated.opening,compileRetirementYearPolicy(reallocated,2026)).closing;
 const step=stepForecastYear(reallocated.context,next,compileRetirementYearPolicy(reallocated,2027));
 expect(step.projection.months.every(m=>m.propertyValueCents.status==='available'&&m.propertyValueCents.value===0)).toBe(true);
});
it('continues an in-progress ADU and rejects a sold host without settlement assumptions',()=>{
 const source=makeRetirementPlan(makeAduPlan({}, {constructionStartDate:'2026-01-01'}));
 const definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0},source),snapshot=makeRetirementSnapshot(source,definition,2027);
 expect(snapshot.commitments).toContainEqual(expect.objectContaining({recordId:'adu-project',action:'continue'}));
 const calendar=validateRetirementCalendar(source,2027);if(calendar.status!=='available')throw Error('calendar');
 const sold=makeRetirementDefinition({...definition,existingProperties:[{propertyId:'home',action:'sell',payoffLoanIds:[]}]},source);
 const result=createRetirementSnapshot(snapshot.context,snapshot.opening,sold,calendar.value);
 expect(result).toMatchObject({status:'unsupported-case',issues:expect.arrayContaining([expect.objectContaining({code:'unsettled-retirement-project'})])});
});
it('requires explicit age assumptions and retains unresolved source coverage',()=>{
 const initial=makeRetirementPlan(),source=makeRetirementPlan({household:{...initial.household,filers:[{...initial.household.filers[0],birthDate:{known:false}},initial.household.filers[1]]}});
 const context=createForecastContext(source,rules),calendar=validateRetirementCalendar(source,2026),opening=projectWithCheckpoints(source,rules).checkpoints[0]!;
 if(calendar.status!=='available')throw Error('calendar');
 expect(createRetirementSnapshot(context,opening,makeRetirementDefinition({},source),calendar.value).status).toBe('needs-data');
 const definition=makeRetirementDefinition({assumptions:{...makeRetirementDefinition({},source).assumptions,owners:[{ownerId:'owner-a',birthDate:{known:true,value:'1960-01-01'}}]}},source);
 expect(createRetirementSnapshot(context,opening,definition,calendar.value).status).toBe('available');
 const credit=makeRetirementPlan({household:{...initial.household,coverageAnswers:{...initial.household.coverageAnswers,priorFederalMinimumTaxCredits:{known:false}}}}),snapshot=makeRetirementSnapshot(credit,undefined,2027);
 expect(snapshot.issues.some(i=>i.field?.includes('priorFederalMinimumTaxCredits')||i.field?.includes('minimumTaxCredit'))).toBe(true);
});

it('extends ADU runtime schedules only with the separately validated calendar',()=>{
 const raw=makeAduPlan({}, {taxEstimation:{mode:'simple',propertyTaxRateBps:120},financing:{id:'project-loan',name:'Loan',aprBps:0,firstAmortizingPaymentMonth:'2028-01',termMonths:120,collateralPropertyId:'home',draws:[{id:'draw',month:'2027-07',amountCents:10_000_000,costAllocations:[{costId:'building-stage',amountCents:10_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true}}});
 const source=makeRetirementPlan(raw),before=JSON.stringify(source),calendar=validateRetirementCalendar(source,2026);if(calendar.status!=='available')throw Error('calendar');
 expect(resolveAduYear(source,2070).projects[0]!.loan!.status).not.toBe('available');
 const resolved=resolveAduPlanningEstimates(source,{year:2070,calendar:calendar.value});
 const year=resolveAduYear(resolved,2070,calendar.value);
 expect(year.projects[0]!.loan).toMatchObject({status:'available'});
 expect(year.projects[0]!.months).toHaveLength(12);
 expect(resolved.properties[0]!.aduProject!.propertyTax.paymentYears.find(y=>y.year===2070)).toMatchObject({complete:{known:true,value:true}});
 expect(resolved.horizonYears).toBe(source.horizonYears);
 expect(JSON.stringify(source)).toBe(before);
});
it('requires host settlement when project cash was committed before physical work',()=>{
 const raw=makeAduPlan(),project=raw.properties[0]!.aduProject!;
 const source=makeRetirementPlan(makeAduPlan({}, {costs:[{...project.costs[0]!,paymentDate:'2026-12-15'}]}));
 const definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'home',action:'sell',payoffLoanIds:[]}]},source),calendar=validateRetirementCalendar(source,2027);
 if(calendar.status!=='available')throw Error('calendar');
 const context=createForecastContext(source,rules),opening=projectWithCheckpoints(source,rules).checkpoints[1]!;
 expect(createRetirementSnapshot(context,opening,definition,calendar.value)).toMatchObject({status:'unsupported-case',issues:expect.arrayContaining([expect.objectContaining({code:'unsettled-retirement-project'})])});
});
