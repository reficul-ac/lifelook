import {expect,it} from 'vitest';
import {createForecastContext} from '../../src/engine/forecast/context';
import {initializeForecast,restoreForecastCheckpoint,serializeForecastCheckpoint} from '../../src/engine/forecast/checkpoint';
import {stepForecastYear,projectWithCheckpoints} from '../../src/engine/forecast/step-year';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {makeRetirementPlan} from '../helpers/retirement';
import {makeAduPlan} from '../helpers/adu';
import {makeFuturePurchasePlan} from '../helpers/future-purchase';
import {mustValidate} from '../helpers/plans';
const rules=loadRuleSet();
const fractional=makeRetirementPlan({horizonYears:3,accounts:[{id:'shares',name:'Fractional shares',ownerId:'owner-a',type:'rsu',openingBalanceCents:0,annualGrowthBps:500,openingIraBasis:{known:false},rsu:{employerId:'employer',currentSharePriceCents:12345,grants:[{id:'grant',name:'Grant',startDate:'2025-01-17',grantValueCents:100_000,grantSharePriceCents:777,vestingMonths:48,vestingFrequency:'monthly',cliffMonths:0,withholdingBps:3333,taxTreatment:'settle-at-vest',openingHeldShares:1.234567,openingBasis:{known:true,value:10000}}]}}]});
const future=makeFuturePurchasePlan({horizonYears:3,openingCashCents:0,accounts:[{id:'broker',name:'Broker',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:20_000_000,openingTaxableBasis:{known:true,value:10_000_000},openingIraBasis:{known:true,value:0},annualGrowthBps:123}],contributions:[{id:'deposit',accountId:'broker',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100_000}}]}, {purchaseFunding:{kind:'taxable-brokerage',accountId:'broker'}});
const aduBase=makeAduPlan({horizonYears:3,openingCashCents:0},{completionDate:'2028-07-31'});
const adu={...aduBase,rentals:aduBase.rentals.map(r=>({...r,availableDate:'2028-08-01',rentStartDate:'2028-09-01'}))};
const drawn=makeAduPlan({horizonYears:3,openingCashCents:0},{completionDate:'2028-01-31',costs:[{...aduBase.properties[0]!.aduProject!.costs[0]!,paymentDate:'2028-01-15'}],financing:{id:'project-loan',name:'Draw loan',aprBps:0,firstAmortizingPaymentMonth:'2028-02',termMonths:120,collateralPropertyId:'home',draws:[{id:'advance',month:'2027-12',amountCents:10_000_000,costAllocations:[{costId:'building-stage',amountCents:10_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true}}});
const drawnPlan={...drawn,rentals:drawn.rentals.map(r=>({...r,availableDate:'2028-02-01',rentStartDate:'2028-03-01'}))};
const independent={...adu,properties:[...adu.properties,{id:'other-property',name:'Independent rental',role:'rental' as const,purchaseDate:'2024-01-01',purchasePriceCents:60_000_000,downPaymentCents:60_000_000,openingValueCents:60_000_000,appreciationBps:0,appreciationOverrides:[],loans:[]}],rentals:[...adu.rentals,{...adu.rentals[0]!,id:'other-rental',propertyId:'other-property',availableDate:'2024-01-01',rentStartDate:'2024-01-01',taxHistory:{...adu.rentals[0]!.taxHistory,california:{known:false as const}}}]};
for(const [name,source] of [['fractional RSUs',fractional],['uncompleted ADU and cash gap',mustValidate(adu)],['later purchase funded by prior deposits',mustValidate(future)],['December draw earmark',mustValidate(drawnPlan)],['independent unavailable rental book',mustValidate(independent)]] as const){
 it(`resumes every January without changing ${name}`,()=>{
  const context=createForecastContext(source,rules),full=projectWithCheckpoints(source,rules);
  expect(full.checkpoints).toHaveLength(source.horizonYears+1);
  for(const checkpoint of full.checkpoints.slice(0,-1)){
   const restored=restoreForecastCheckpoint(context,serializeForecastCheckpoint(checkpoint));
   expect(restored.status).toBe('available');if(restored.status!=='available')throw Error('restore failed');
   let opening=restored.value;
   const months=[],years=[],taxStates=[],cashSchedules=[],loanSchedules=[];
   while(opening.year<source.startYear+source.horizonYears){const step=stepForecastYear(context,opening,{kind:'working'});months.push(...step.projection.months);years.push(...step.projection.years);taxStates.push(...step.projection.taxStates);cashSchedules.push(...step.projection.cashSchedules);loanSchedules.push(...step.projection.loanSchedules);opening=step.closing;}
   expect(months).toEqual(full.projection.months.filter(m=>m.year>=checkpoint.year));
   expect(years).toEqual(full.projection.years.filter(m=>m.year>=checkpoint.year));
   for(const [actual,key]of [[taxStates,'taxStates'],[cashSchedules,'cashSchedules'],[loanSchedules,'loanSchedules']]as const)expect(actual).toEqual(full.projection[key].filter(m=>m.year>=checkpoint.year));
   expect(serializeForecastCheckpoint(opening)).toBe(serializeForecastCheckpoint(full.checkpoints.at(-1)!));
  }
 });
}
it('carries contributions to a brokerage never selected for funding',()=>{
 const source=makeRetirementPlan({contributions:[{id:'deposit',accountId:'stocks',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100}}]});
 const trace=projectWithCheckpoints(source,rules);
 expect(trace.checkpoints[1]!.brokerageBasis.stocks).toEqual({status:'available',value:100_001_200});
 expect(trace.checkpoints[1]!.brokerageBasisHistory.stocks).toEqual({known:true,value:100_000_000});
});
it('rejects malformed, foreign-source and foreign-rule checkpoints',()=>{
 const source=makeRetirementPlan(),context=createForecastContext(source,rules),opening=initializeForecast(context),serialized=serializeForecastCheckpoint(opening);
 const other=createForecastContext(makeRetirementPlan({revision:1}),rules);
 expect(restoreForecastCheckpoint(other,serialized).status).not.toBe('available');
 expect(restoreForecastCheckpoint({...context,ruleBinding:'other-rules'},serialized).status).not.toBe('available');
 for(const change of [{year:2025},{schemaVersion:2},{accountExact:{stocks:{status:'available',value:'NaN'}}},{taxState:null}])expect(restoreForecastCheckpoint(context,JSON.stringify({...opening,...change})).status).not.toBe('available');
 expect(restoreForecastCheckpoint(context,'{').status).not.toBe('available');
});

it('carries known new Roth contributions separately from unanswered opening history',()=>{
 const source=makeRetirementPlan({accounts:[{id:'roth',name:'Roth',ownerId:'owner-a',type:'roth-ira',openingBalanceCents:10000,annualGrowthBps:0,openingIraBasis:{known:true,value:0}}],salaries:[{id:'salary',name:'Salary',ownerId:'owner-a',employerId:'employer',annualGrossCents:8_000_000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],contributions:[{id:'deposit',accountId:'roth',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100}}]});
 const trace=projectWithCheckpoints(source,rules);
 expect(trace.checkpoints[1]!.rothHistoryByAccount.roth).toMatchObject({openingContributionBasis:{known:false},contributionsSinceStartCents:{status:'available',value:1200},conversionLayers:[]});
});
it('rejects malformed retirement account, basis and known-clock records before resuming',()=>{
 const source=makeRetirementPlan(),context=createForecastContext(source,rules),opening=initializeForecast(context);
 const invalid=[{...opening,retirementAccountBalances:[{accountId:'stocks',ownerId:'other-owner',type:'traditional-ira',balanceExact:'Infinity',basis:{known:true,value:-1}}]}, {...opening,taxState:{...opening.taxState,retirementAccountState:{iraBasisByOwner:{'owner-a':{federal:{known:true,value:-1},california:{known:false}}},rothByAccount:{}}}}, {...opening,rothHistoryByAccount:{stocks:{openingContributionBasis:{known:false},contributionsSinceStartCents:{status:'available',value:-1},conversionLayers:[],firstKnownContributionYear:99999}}}];
 for(const checkpoint of invalid)expect(restoreForecastCheckpoint(context,JSON.stringify(checkpoint)).status).toBe('unsupported-case');
});
it('retains the original-basis survival fraction across split funding runs and rejects missing/malformed fractions',()=>{
 const source=mustValidate(future),context=createForecastContext(source,rules),trace=projectWithCheckpoints(source,rules),checkpoint=trace.checkpoints[2]!,fraction=(checkpoint as any).brokerageOpeningBasisSurvival?.broker;expect(fraction?.status).toBe('available');expect(Number(fraction.value)).toBeGreaterThan(0);expect(Number(fraction.value)).toBeLessThan(1);const restored=restoreForecastCheckpoint(context,serializeForecastCheckpoint(checkpoint));expect(restored.status).toBe('available');if(restored.status!=='available')throw Error('restore');expect(stepForecastYear(context,restored.value,{kind:'working'})).toEqual(stepForecastYear(context,checkpoint,{kind:'working'}));for(const value of [undefined,{'broker':{status:'available',value:'1.1'}},{'broker':{status:'available',value:'-0.1'}},{'broker':{status:'available',value:'NaN'}}])expect(restoreForecastCheckpoint(context,JSON.stringify({...checkpoint,brokerageOpeningBasisSurvival:value})).status).toBe('unsupported-case');
});
