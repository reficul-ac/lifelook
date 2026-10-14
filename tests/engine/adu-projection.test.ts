import {describe,expect,it} from 'vitest';
import type {AduFinancing,PlanDocument} from '../../src/engine/model/plan';
import {calculateProjection} from '../../src/engine/projection';
import {calculateFundingNeed,cashFlowBeforeInvestments} from '../../src/engine/property/adu-projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {MAX_CENTS} from '../../src/engine/money';
import {makePlan,mustValidate} from '../helpers/plans';
import {makeAduPlan,makeAduTreatments,aduValue} from '../helpers/adu';
export const aduLoan=(overrides:Partial<AduFinancing>={}):AduFinancing=>({id:'adu-loan',name:'ADU debt',aprBps:0,firstAmortizingPaymentMonth:'2029-01',termMonths:120,collateralPropertyId:'home',draws:[{id:'draw',month:'2027-07',amountCents:20_000_000,costAllocations:[{costId:'building-stage',amountCents:20_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true},...overrides});
const run=(p:PlanDocument)=>calculateProjection(mustValidate(p),loadRuleSet());
function baseline(p:PlanDocument):PlanDocument {const {aduProject,...home}=p.properties[0]!;return{...p,properties:[{...home,role:'primary'}],rentals:[]};}
describe('ADU projection accounting and availability',()=>{
 it.each([false,true])('separates equity from net-worth gain, financed=%s',financed=>{
  const p=makeAduPlan({},financed?{financing:aduLoan()}:{}),build=run(p),noBuild=run(baseline(p)),row=build.months.find(m=>m.date==='2027-07')!,base=noBuild.months.find(m=>m.date===row.date)!;
  expect(aduValue(row.equityCents)-aduValue(base.equityCents)).toBe(financed?2_000_000:22_000_000);expect(aduValue(row.netWorthCents)-aduValue(base.netWorthCents)).toBe(-8_000_000);
  expect(aduValue(row.adu!.constructionCostCents)).toBe(30_000_000);expect(aduValue(row.adu!.completionValueAddedCents)).toBe(22_000_000);expect(aduValue(row.grossIncomeCents)).toBe(0);expect(aduValue(row.propertyExpensesCents)).toBe(30_000_000);expect(aduValue(cashFlowBeforeInvestments(row))).toBe(-30_000_000);
  expect(row.properties).toHaveLength(1);expect(aduValue(row.properties[0]!.combinedLivingAreaSqFt!)).toBe(2600);
  if(financed){expect(aduValue(row.loans[0]!.drawCents!)).toBe(20_000_000);expect(aduValue(build.years[1]!.loans[0]!.drawCents!)).toBe(20_000_000);}
 });
 it('posts June completion after growth and appreciates it starting in July',()=>{
  const p=makeAduPlan({}, {completionDate:'2027-06-30',productionPeriod:{known:true,value:{startDate:'2027-01-01',endDate:'2027-06-30',uninterrupted:true}},costs:[{id:'building-stage',name:'Building',paymentDate:'2027-06-01',amountCents:30_000_000,category:'building',treatments:makeAduTreatments(30_000_000)}]});const result=run({...p,properties:[{...p.properties[0]!,appreciationBps:1200}]}),june=result.months.find(m=>m.date==='2027-06')!,july=result.months.find(m=>m.date==='2027-07')!;
  // Independently evaluated Decimal worksheet: q=1.12^(1/12), V=100m*q^18+22m.
  expect(aduValue(june.propertyValueCents)).toBe(140_529_659);expect(aduValue(june.propertyGrowthCents)).toBe(1_114_132);expect(aduValue(july.propertyValueCents)).toBe(141_863_116);expect(aduValue(july.propertyGrowthCents)).toBe(1_333_457);
 });
 it('marks WIP value incomplete but retains original-home growth and recovers at completion',()=>{
  const p=makeAduPlan(),result=run({...p,properties:[{...p.properties[0]!,appreciationBps:1200}]});const june=result.months.find(m=>m.date==='2027-06')!,july=result.months.find(m=>m.date==='2027-07')!,august=result.months.find(m=>m.date==='2027-08')!;
  expect(june.propertyValueCents.status).toBe('needs-data');expect(june.equityCents.status).toBe('needs-data');expect(june.netWorthCents.status).toBe('needs-data');expect(june.properties[0]!.knownExistingHomeValueCents!.status).toBe('available');expect(aduValue(july.propertyValueCents)).toBe(aduValue(july.properties[0]!.knownExistingHomeValueCents!)+22_000_000);
  expect(aduValue(july.propertyGrowthCents)).toBeGreaterThan(0);expect(aduValue(august.propertyGrowthCents)).toBeGreaterThan(aduValue(july.propertyGrowthCents));expect(aduValue(result.years[2]!.adu!.completionValueAddedCents)).toBe(0);
 });
 it('cannot spend future-stage earmarks on interest without owner funding',()=>{
  const p=makeAduPlan({openingCashCents:0,horizonYears:1},{financing:aduLoan({aprBps:600,draws:[{id:'early',month:'2026-12',amountCents:10_000_000,costAllocations:[{costId:'building-stage',amountCents:10_000_000}]}],interestTaxRows:[{id:'dec-interest',month:'2026-12',treatments:makeAduTreatments(50_000,'currentDeductionCents')}]})});const result=run(p),dec=result.months[11]!;
  expect(aduValue(dec.reserveCents)).toBe(9_950_000);expect(aduValue(dec.adu!.earmarkedCashCents)).toBe(10_000_000);expect(aduValue(dec.adu!.unrestrictedCashCents)).toBe(-50_000);expect(dec.fundingStatus).toBe('conditional-on-gap');expect(aduValue(calculateFundingNeed(result.months))).toBe(50_000);
 });
 it('keeps declared cash and original home known when added value overflows',()=>{
  const p=makeAduPlan(),result=run({...p,properties:[{...p.properties[0]!,aduArea:10_000_000,aduProject:{...p.properties[0]!.aduProject!,valuation:{kind:'adu-value-per-square-foot',valuePerSquareFootCents:MAX_CENTS}}}]});const july=result.months.find(m=>m.date==='2027-07')!;
  expect(july.propertyValueCents).toMatchObject({status:'needs-data',issues:expect.arrayContaining([expect.objectContaining({code:'monetary-overflow'})])});expect(july.reserveCents.status).toBe('available');expect(july.properties[0]!.knownExistingHomeValueCents).toEqual({status:'available',value:100_000_000});expect(aduValue(july.adu!.constructionCostCents)).toBe(30_000_000);
 });
 it('recovers wages without filtering away prospective expense references',()=>{
  const p=makeAduPlan({salaries:[{id:'wage',name:'Wage',ownerId:'owner-a',employerId:'employer',annualGrossCents:12_000_000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],expenses:[{id:'original',name:'Original expense',propertyId:'home',amountCents:100,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'operating'},{id:'huge',name:'Unrelated expense',amountCents:MAX_CENTS,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'personal'}]},{sharedExpenseOverrides:[{id:'prospective',expenseId:'original'}]});const result=run(p);
  expect(aduValue(result.years[0]!.salaryCents)).toBe(12_000_000);expect(result.years[0]!.expensesCents.status).toBe('unsupported-case');expect(result.years[0]!.totalTaxCents.status).toBe('available');expect(aduValue(result.years[1]!.adu!.constructionCostCents)).toBe(30_000_000);
 });
 it('preserves known paid amounts while missing tax schedule blocks dependent cash',()=>{
  const p=makeAduPlan(),pr=p.properties[0]!.aduProject!,result=run({...p,properties:[{...p.properties[0]!,aduProject:{...pr,propertyTax:{...pr.propertyTax,paymentYears:pr.propertyTax.paymentYears.map(y=>y.year===2027?{...y,complete:{known:false}}:y)}}}]});const july=result.months.find(m=>m.date==='2027-07')!;
  expect(july.cashFlowCents.status).toBe('needs-data');expect(july.reserveCents.status).toBe('needs-data');expect(aduValue(july.adu!.constructionCostCents)).toBe(30_000_000);expect(aduValue(july.adu!.projectTaxPaidCents)).toBe(0);expect(july.propertyValueCents.status).toBe('available');
 });
 it('contains construction-total overflow without erasing the completion valuation',()=>{
  const costs=['one','two'].map(id=>({id,name:id,paymentDate:'2027-07-01',amountCents:MAX_CENTS,category:'building' as const,treatments:makeAduTreatments(MAX_CENTS)}));
  const result=run(makeAduPlan({}, {costs})),july=result.months.find(m=>m.date==='2027-07')!;
  expect(july.adu!.constructionCostCents.status).toBe('unsupported-case');expect(july.adu!.completionValueAddedCents).toEqual({status:'available',value:22_000_000});expect(july.propertyValueCents.status).toBe('available');expect(july.reserveCents.status).toBe('unsupported-case');
 });
 it('contains loan overflow and preserves independently declared stage and draw cash',()=>{
  const result=run(makeAduPlan({}, {financing:aduLoan({aprBps:100000,draws:[{id:'huge-draw',month:'2027-07',amountCents:MAX_CENTS,costAllocations:[{costId:'building-stage',amountCents:MAX_CENTS}]}]}),costs:[{id:'building-stage',name:'Cost',paymentDate:'2027-07-01',amountCents:MAX_CENTS,category:'building',treatments:makeAduTreatments(MAX_CENTS)}]}));
  const july=result.months.find(m=>m.date==='2027-07')!;expect(aduValue(july.adu!.financingProceedsCents)).toBe(MAX_CENTS);expect(aduValue(july.adu!.constructionCostCents)).toBe(MAX_CENTS);expect(july.debtPaymentCents.status).not.toBe('available');expect(july.properties[0]!.knownExistingHomeValueCents!.status).toBe('available');expect(result.months[0]!.loanBalanceCents).toEqual({status:'available',value:0});
 });
 it('contains annual cash-fact overflow when each monthly payment fits',()=>{
  const costs=[['one','2027-06-01'],['two','2027-07-01']].map(([id,paymentDate])=>({id:id!,name:id!,paymentDate:paymentDate!,amountCents:60_000_000_000_000,category:'building' as const,treatments:makeAduTreatments(60_000_000_000_000)}));
  const result=run(makeAduPlan({}, {costs}));expect(aduValue(result.months.find(m=>m.date==='2027-06')!.adu!.constructionCostCents)).toBe(60_000_000_000_000);expect(result.years[1]!.adu!.constructionCostCents.status).toBe('unsupported-case');expect(result.months.find(m=>m.date==='2027-07')!.propertyValueCents.status).toBe('available');
 });
 it('preserves California books and all known project flows when only federal treatment is unanswered',()=>{
  const p=makeAduPlan(),pr=p.properties[0]!.aduProject!;const result=run({...p,properties:[{...p.properties[0]!,aduProject:{...pr,costs:pr.costs.map(c=>({...c,treatments:{...c.treatments,federal:{known:false}}}))}}]});
  expect(result.closingTaxState.rentals['new-adu']!.california.status).toBe('available');expect(result.closingTaxState.rentals['new-adu']!.federal.status).toBe('needs-data');expect(aduValue(result.years[1]!.adu!.constructionCostCents)).toBe(30_000_000);expect(aduValue(result.years[1]!.propertyValueCents)).toBe(122_000_000);expect(result.years[1]!.totalTaxCents.status).toBe('needs-data');
 });
 it('extends the horizon without changing prior postings or reactivating recovery',()=>{
  const p=makeAduPlan(),short=run({...p,horizonYears:2}),long=run(p);expect(long.months.slice(0,24)).toEqual(short.months);expect(aduValue(long.years[2]!.adu!.completionValueAddedCents)).toBe(0);expect(aduValue(long.closingTaxState.aduProjects!['adu-project']!.federal).capitalizedBuildingCents).toBe(30_000_000);
 });
 it('sums movements but carries December balances and omits project fields without projects',()=>{
  const result=run(makeAduPlan()),y=result.years[1]!;expect(aduValue(y.adu!.constructionCostCents)).toBe(30_000_000);expect(y.adu!.unrestrictedCashCents).toEqual(result.months[23]!.adu!.unrestrictedCashCents);expect(aduValue(y.properties[0]!.openingValueCents)).toBe(100_000_000);expect(aduValue(y.properties[0]!.completionValueAddedCents!)).toBe(22_000_000);
  const legacy=run(makePlan());expect(legacy.months[0]).not.toHaveProperty('adu');expect(legacy.years[0]).not.toHaveProperty('adu');expect(aduValue(calculateFundingNeed(legacy.months))).toBe(0);
 });
});
