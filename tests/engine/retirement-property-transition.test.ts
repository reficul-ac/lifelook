import {expect,it} from 'vitest';
import {compilePropertyTransition,applyPropertyTransition} from '../../src/engine/retirement/property-transition';
import {resolveConversionBasis,type ConversionBasisInput,type ConversionBasisResult} from '../../src/engine/retirement/property-basis';
import type {Available} from '../../src/engine/model/results';
import type {PropertyLoan,Property} from '../../src/engine/model/plan';
import {compileRetirementYearPolicy} from '../../src/engine/retirement/snapshot';
import {stepForecastYear} from '../../src/engine/forecast/step-year';
import {makeRetirementPlan,makeRetirementDefinition,makeRetirementTarget,makeRetirementSnapshot} from '../helpers/retirement';
import {makeFuturePurchasePlan} from '../helpers/future-purchase';
import {loadReferences,assertReference} from '../helpers/references';
const loan=(id:string,principal:number):PropertyLoan=>({id,name:id,originalPrincipalCents:principal,aprBps:0,originationDate:'2024-01-01',acquisitionDate:'2024-01-01',termMonths:360,firstPaymentDate:'2024-02-29',openingBalance:{known:true,value:principal},openingPayment:{known:true,value:100000},collateralPropertyId:'home',proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:{known:true,value:true},qualifiedPrincipalCents:{known:true,value:principal},historyComplete:{known:true,value:true}},proceedsAllocations:[{propertyId:'home',use:'personal',share:{numerator:1,denominator:1}}],financingAtRiskQualification:{known:true,value:true}});
const home:Property={id:'home',name:'Home',role:'primary',purchaseDate:'2024-01-01',purchasePriceCents:50_000_000,downPaymentCents:20_000_000,openingValueCents:40_000_000,appreciationBps:0,appreciationOverrides:[],loans:[loan('first',20_000_000),loan('second',10_000_000)]};
it.each(loadReferences<ConversionBasisInput,Available<ConversionBasisResult>>('retirement-conversion-basis'))('$id',c=>assertReference(resolveConversionBasis(c.input),c.expected,c.toleranceCents));
it.each([0,2000,10000])('derives a fixed-price mortgage with %s bps down',downPaymentBps=>{
 const source=makeRetirementPlan(),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,newProperties:[makeRetirementTarget({id:'target',financing:{kind:'mortgage',downPaymentBps,aprBps:0,termMonths:360}})]},source);
 const snapshots=[makeRetirementSnapshot(source,definition),makeRetirementSnapshot(source,definition,2027)];
 for(const snapshot of snapshots){const draft=compilePropertyTransition(snapshot),purchase=draft.events.find(e=>e.kind==='purchase')!;
 expect(purchase).toMatchObject({downPaymentCents:downPaymentBps===0?0:downPaymentBps===2000?12_000_000:60_000_000,mortgagePrincipalCents:downPaymentBps===0?60_000_000:downPaymentBps===2000?48_000_000:0,buyingCostsCents:1_200_000});
 const applied=applyPropertyTransition(snapshot.opening,draft.events);expect(applied.opening.propertyExact.target).toEqual({status:'available',value:'60000000'});
 expect(applyPropertyTransition(applied.opening,draft.events).opening).toEqual(applied.opening);
 }
});
it('pays one retained loan once while keeping the property and other loan schedule',()=>{
 const source=makeRetirementPlan({openingCashCents:30_000_000,properties:[home]}),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'home',action:'keep',payoffLoanIds:['first']}]},source),snapshot=makeRetirementSnapshot(source,definition),draft=compilePropertyTransition(snapshot),applied=applyPropertyTransition(snapshot.opening,draft.events);
 expect(applied.opening.reserve).toEqual({status:'available',value:10_000_000});expect(applied.opening.propertyExact.home).toEqual(snapshot.opening.propertyExact.home);
 expect(applied.opening.loanClosing.first).toEqual({status:'available',value:0});
 const step=stepForecastYear(snapshot.context,applied.opening,compileRetirementYearPolicy(snapshot,2026));
 expect(step.projection.months[0]!.loans.map(l=>l.loanId)).toEqual(['second']);
 expect(step.projection.months[0]!.loans[0]!.paymentCents).toEqual({status:'available',value:100000});
});
it('settles every sold-property loan once and never invents unowned proceeds',()=>{
 const source=makeRetirementPlan({properties:[home]}),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'home',action:'sell',payoffLoanIds:['first']}]},source),snapshot=makeRetirementSnapshot(source,definition),draft=compilePropertyTransition(snapshot);
 expect(draft.events.map(e=>e.kind)).toEqual(['sale']);
 const applied=applyPropertyTransition(snapshot.opening,draft.events);
 expect(applied.opening.reserve).toEqual({status:'available',value:7_600_000});
 expect(applied.opening.loanClosing).toMatchObject({first:{status:'available',value:0},second:{status:'available',value:0}});
 const future=makeRetirementPlan(makeFuturePurchasePlan()),pending=makeRetirementSnapshot(future,makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'future-home',action:'sell',payoffLoanIds:[]}]},future));
 expect(compilePropertyTransition(pending).events).toEqual([]);
});
it('keeps two new rental tax units and budgets independent, with February loan service',()=>{
 const source=makeRetirementPlan(),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,newProperties:[makeRetirementTarget({id:'a',monthlyRentCents:280000,financing:{kind:'mortgage',downPaymentBps:2000,aprBps:0,termMonths:360}}),makeRetirementTarget({id:'b',monthlyRentCents:180000,annualOperatingCostsCents:360000})]},source),snapshot=makeRetirementSnapshot(source,definition),applied=applyPropertyTransition(snapshot.opening,compilePropertyTransition(snapshot).events);
 const step=stepForecastYear(snapshot.context,applied.opening,compileRetirementYearPolicy(snapshot,2026));
 expect(step.projection.months[0]!.properties.map(p=>p.closingValueCents)).toEqual([{status:'available',value:60_000_000},{status:'available',value:60_000_000}]);
 expect(step.projection.months[0]!.loans[0]!.paymentCents).toEqual({status:'available',value:0});expect(step.projection.months[1]!.loans[0]!.paymentCents).toEqual({status:'available',value:133333});
 expect(step.projection.cashSchedules.filter(s=>s.kind==='rent').map(s=>s.schedule.status==='available'?s.schedule.value.annualCents:undefined)).toEqual([3_360_000,2_160_000]);
 expect(Object.keys(applied.opening.taxState.rentals)).toHaveLength(2);
});
it('keeps conversion gain basis and unavailable independent tax books',()=>{
 const source=makeRetirementPlan({properties:[{...home,loans:[]}]}),base=makeRetirementDefinition({},source),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'home',action:'convert-to-rental',payoffLoanIds:[],conversion:{monthlyRentCents:280000,annualOperatingCostsCents:720000,vacancyBps:0,rentGrowthBps:0}}],assumptions:{...base.assumptions,properties:[{propertyId:'home',adjustedBasisByBook:{'california-amt':{known:false}}}]}},source),snapshot=makeRetirementSnapshot(source,definition),event=compilePropertyTransition(snapshot).events[0]!;
 expect(event.basisByBook?.federal).toMatchObject({status:'available',value:{gainBuildingBasisCents:40_000_000,depreciationBuildingBasisCents:32_000_000}});
 expect(event.basisByBook?.['california-amt'].status).toBe('needs-data');
 const applied=applyPropertyTransition(snapshot.opening,[event]);
 expect(applied.opening.reserve).toEqual(snapshot.opening.reserve);
 expect(Object.values(applied.opening.taxState.rentals)[0]!['california-amt'].status).toBe('needs-data');
});
it('recovers the lesser conversion basis with mid-month and full subsequent-year depreciation',()=>{
 const source=makeRetirementPlan({properties:[{...home,loans:[]}]}),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'home',action:'convert-to-rental',payoffLoanIds:[],conversion:{monthlyRentCents:280000,annualOperatingCostsCents:720000,vacancyBps:0,rentGrowthBps:0}}]},source),snapshot=makeRetirementSnapshot(source,definition),applied=applyPropertyTransition(snapshot.opening,compilePropertyTransition(snapshot).events);
 const first=stepForecastYear(snapshot.context,applied.opening,compileRetirementYearPolicy(snapshot,2026));
 const second=stepForecastYear(snapshot.context,first.closing,compileRetirementYearPolicy(snapshot,2027));
 const a=Object.values(first.closing.taxState.rentals)[0]!.federal,b=Object.values(second.closing.taxState.rentals)[0]!.federal;
 expect(a).toMatchObject({status:'available',value:{cumulativeDepreciationCents:1_115_152}});
 expect(b).toMatchObject({status:'available',value:{cumulativeDepreciationCents:2_278_788}});
});
it('charges a property payoff fee once across all selected loans',()=>{
 const source=makeRetirementPlan({openingCashCents:40_000_000,properties:[home]}),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'home',action:'keep',payoffLoanIds:['first','second'],payoffFeesCents:1000}]},source),snapshot=makeRetirementSnapshot(source,definition);
 expect(applyPropertyTransition(snapshot.opening,compilePropertyTransition(snapshot).events).opening.reserve).toEqual({status:'available',value:9_999_000});
});
it('locates an overflowing purchase basis without discarding the independent asset value',()=>{
 const source=makeRetirementPlan(),base=makeRetirementDefinition({},source),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,assumptions:{...base.assumptions,buildingShareBps:10000},newProperties:[makeRetirementTarget({id:'large',capitalizedBuyingCostBps:10000,purchasePriceCents:99_999_999_999_999})]},source),snapshot=makeRetirementSnapshot(source,definition);
 const purchase=compilePropertyTransition(snapshot).events.find(e=>e.kind==='purchase')!;
 expect(purchase.assetCents).toEqual({status:'available',value:99_999_999_999_999});
 expect(purchase.basisByBook?.federal.status).toBe('unsupported-case');
});
it('isolates an unreportable mortgage payment while retaining its property value',()=>{
 const source=makeRetirementPlan(),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,newProperties:[makeRetirementTarget({id:'large-loan',purchasePriceCents:60_000_000_000_000,financing:{kind:'mortgage',downPaymentBps:0,aprBps:100000,termMonths:1}})]},source),snapshot=makeRetirementSnapshot(source,definition);
 const applied=applyPropertyTransition(snapshot.opening,compilePropertyTransition(snapshot).events),step=stepForecastYear(snapshot.context,applied.opening,compileRetirementYearPolicy(snapshot,2026));
 expect(step.projection.months[0]!.properties[0]!.closingValueCents).toEqual({status:'available',value:60_000_000_000_000});
 expect(step.projection.months[0]!.loans[0]!.paymentCents.status).toBe('unsupported-case');
});
it('includes land and confirmed capitalized acquisition costs in initial rental risk',()=>{
 const source=makeRetirementPlan(),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,newProperties:[makeRetirementTarget({id:'capitalized',capitalizedBuyingCostBps:10000})]},source),snapshot=makeRetirementSnapshot(source,definition),applied=applyPropertyTransition(snapshot.opening,compilePropertyTransition(snapshot).events);
 expect(Object.values(applied.opening.taxState.rentals)[0]!.federal).toMatchObject({status:'available',value:{recoveryBasisCents:48_960_000,atRiskCents:61_200_000}});
});
it('does not invent capitalized buying-cost basis when classification is unanswered',()=>{
 const source=makeRetirementPlan(),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,newProperties:[makeRetirementTarget({id:'cash-cost'})]},source),snapshot=makeRetirementSnapshot(source,definition),applied=applyPropertyTransition(snapshot.opening,compilePropertyTransition(snapshot).events);
 expect(Object.values(applied.opening.taxState.rentals)[0]!.federal).toMatchObject({status:'available',value:{recoveryBasisCents:48_000_000,atRiskCents:60_000_000}});
});
it('uses total conversion loss basis including land for initial risk',()=>{
 const source=makeRetirementPlan({properties:[{...home,loans:[]}]}),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'home',action:'convert-to-rental',payoffLoanIds:[],conversion:{monthlyRentCents:280000,annualOperatingCostsCents:720000,vacancyBps:0,rentGrowthBps:0}}]},source),snapshot=makeRetirementSnapshot(source,definition),applied=applyPropertyTransition(snapshot.opening,compilePropertyTransition(snapshot).events);
 expect(Object.values(applied.opening.taxState.rentals)[0]!.federal).toMatchObject({status:'available',value:{recoveryBasisCents:32_000_000,atRiskCents:40_000_000}});
});
it('retains entered prior depreciation as a recovery dependency instead of resetting it to zero',()=>{
 const source=makeRetirementPlan({properties:[{...home,loans:[]}]}),base=makeRetirementDefinition({},source),definition=makeRetirementDefinition({mode:'reallocate',stockGrowthBps:0,existingProperties:[{propertyId:'home',action:'convert-to-rental',payoffLoanIds:[],conversion:{monthlyRentCents:280000,annualOperatingCostsCents:720000,vacancyBps:0,rentGrowthBps:0}}],assumptions:{...base.assumptions,properties:[{propertyId:'home',priorDepreciationByBook:{federal:{known:true,value:3000000}}}]}},source),snapshot=makeRetirementSnapshot(source,definition),event=compilePropertyTransition(snapshot).events[0]!;
 expect(event.basisByBook!.federal).toMatchObject({status:'needs-data'});expect(definition.assumptions.properties[0]!.priorDepreciationByBook!.federal).toEqual({known:true,value:3000000});
});
