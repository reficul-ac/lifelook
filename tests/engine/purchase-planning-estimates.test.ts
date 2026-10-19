import {describe,expect,it} from 'vitest';
import {calculateProjection,loadRuleSet} from '../../src/engine';
import type {PlanDocument,RentalBookState,RentalUnit,TaxBook} from '../../src/engine';
import {makeFuturePurchasePlan} from '../helpers/future-purchase';
import {mustValidate} from '../helpers/plans';

const books:readonly TaxBook[]=['federal','california','federal-amt','california-amt'];
function rental(overrides:Partial<RentalUnit>={}):RentalUnit {
 return{id:'future-rental',propertyId:'future-home',availableDate:'2027-06-15',rentStartDate:'2027-06-15',monthlyRentCents:0,rentGrowthBps:0,activeParticipation:{known:false},loanAllocations:[],convertedFromPersonalUse:false,conversionBuildingFmv:{known:false},
  qualifications:{ordinaryResidential:{known:false},longTermFairMarketLease:{known:false},noPersonalUse:{known:false},noSubstantialTenantServices:{known:false},advancedBasisAdjustments:{known:false},californiaSmallBusinessQualification:{known:false}},
  taxHistory:Object.fromEntries(books.map(book=>[book,{known:false}])) as RentalUnit['taxHistory'],qbi:{qualification:{known:false},wagesCents:{known:false},ubiaCents:{known:false},openingLossVintages:{known:false}},...overrides};
}
function plannedRental(mode:'simple'|'detailed'='simple'):PlanDocument {
 const base=makeFuturePurchasePlan({openingCashCents:16_000_000});
 const mortgage=base.properties[0]!.loans[0]!;
 return {...base,properties:[{...base.properties[0]!,role:'rental',purchaseTaxEstimation:mode==='simple'?{mode,buildingShareBps:8000}:{mode},loans:[{...mortgage,aprBps:0,proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:{known:false},qualifiedPrincipalCents:{known:false},historyComplete:{known:false}},proceedsAllocations:[],financingAtRiskQualification:{known:false}}]}],rentals:[rental()]};
}
const project=(plan:PlanDocument)=>calculateProjection(mustValidate(plan),loadRuleSet());
describe('future purchase planning tax estimates',()=>{
 it('keeps future rental forecasts numeric while saved tax answers remain unknown',()=>{
  const plan=plannedRental(),before=structuredClone(plan),result=project(plan);
  for(const year of result.years)for(const amount of [year.totalTaxCents,year.expensesCents,year.cashFlowCents,year.netWorthCents])expect(amount.status).toBe('available');
  expect(result.years[0]!.rentCents).toEqual({status:'available',value:0});
  expect(result.years[1]!.netWorthCents).toEqual({status:'available',value:16_000_000});
  expect(plan).toEqual(before);expect(plan.rentals[0]!.taxHistory.federal).toEqual({known:false});
 });
 it('excludes land and starts ordinary depreciation only when the rental is ready',()=>{
  const result=project(plannedRental()),opening=result.openingTaxState.rentals['future-rental']!.federal;
  expect(opening).toMatchObject({status:'available',value:{recoveryBasisCents:64_000_000,adjustedBuildingBasisCents:64_000_000,atRiskCents:80_000_000,cumulativeDepreciationCents:0,lossVintages:[]}});
  const prior=result.taxStates.find(state=>state.year===2026)!.closing.rentals['future-rental']!.federal;
  expect(prior).toMatchObject({status:'available',value:{cumulativeDepreciationCents:0}});
  const closing=result.taxStates.find(state=>state.year===2027)!.closing.rentals['future-rental']!.federal;
  expect(closing).toMatchObject({status:'available',value:{recoveryBasisCents:64_000_000,cumulativeDepreciationCents:1_260_606}});
 });
 it('retains explicitly entered acquisition books instead of replacing them with an estimate',()=>{
  const plan=plannedRental(),book:RentalBookState={recoveryBasisCents:40_000_000,adjustedBuildingBasisCents:40_000_000,cumulativeDepreciationCents:0,atRiskCents:10_000_000,atRiskSuspendedCents:0,passiveSuspendedCents:0,lossVintages:[]};
  const changed={...plan,rentals:[rental({taxHistory:Object.fromEntries(books.map(key=>[key,{known:true,value:book}])) as RentalUnit['taxHistory']})]},result=project(changed);
  expect(result.openingTaxState.rentals['future-rental']!.federal).toEqual({status:'available',value:book});
 });
 it('excludes explicitly unqualified borrowing from the assumed opening amount at risk',()=>{
  const plan=plannedRental(),property=plan.properties[0]!,loan=property.loans[0]!;
  const result=project({...plan,properties:[{...property,loans:[{...loan,financingAtRiskQualification:{known:true,value:false}}]}]});
  expect(result.openingTaxState.rentals['future-rental']!.federal).toMatchObject({status:'available',value:{atRiskCents:16_000_000}});
 });
 it('leaves detailed-mode answers required in the acquisition year',()=>{
  const result=project(plannedRental('detailed'));
  expect(result.years[0]!.totalTaxCents.status).toBe('available');expect(result.years[1]!.totalTaxCents.status).toBe('needs-data');
 });
});
