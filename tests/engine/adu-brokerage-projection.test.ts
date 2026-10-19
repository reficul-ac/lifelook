import {describe,expect,it} from 'vitest';
import type {Account,PlanDocument} from '../../src/engine/model/plan';
import {calculateProjection} from '../../src/engine/projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {calculateAduBuildComparison} from '../../src/engine/property/adu-comparison';
import {makeAduPlan,makeAduTreatments,aduValue} from '../helpers/adu';
import {mustValidate} from '../helpers/plans';
import {makeAllocationPolicy} from '../helpers/allocations';

function fundedPlan(basis:number|null=20_000_000,overrides:Partial<PlanDocument>={}):PlanDocument {
 const plan=makeAduPlan({openingCashCents:0,accounts:[{id:'brokerage',name:'Standard brokerage',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:20_000_000,annualGrowthBps:0,openingIraBasis:{known:true,value:0},...(basis===null?{}:{openingTaxableBasis:{known:true,value:basis}})}],...overrides},
 {ownerFunding:{kind:'taxable-brokerage',accountId:'brokerage'},valuation:{kind:'value-added',valueAddedCents:10_000_000},costs:[{id:'building-stage',name:'Building',paymentDate:'2027-07-01',amountCents:10_000_000,category:'building',treatments:makeAduTreatments(10_000_000)}]});
 return{...plan,rentals:plan.rentals.map(unit=>({...unit,activeParticipation:{known:true,value:false}}))};
}
const project=(plan:PlanDocument)=>calculateProjection(mustValidate(plan),loadRuleSet());
describe('ADU brokerage construction funding in the household forecast',()=>{
 it('keeps a numeric shortfall forecast when the funding brokerage also receives automatic savings',()=>{
  const owners=['a','b'] as const;
  const ira=(owner:typeof owners[number],type:'roth-ira'|'traditional-ira'):Account=>({id:`${type}-${owner}`,name:`${type} ${owner}`,ownerId:`owner-${owner}`,type,openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:true,value:0}});
  const accounts:readonly Account[]=[{id:'brokerage',name:'Build savings',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:5_000_000,annualGrowthBps:800,openingIraBasis:{known:true,value:0},openingTaxableBasis:{known:true,value:4_500_000}},
   ...owners.flatMap(owner=>[ira(owner,'roth-ira'),ira(owner,'traditional-ira')]),
   {id:'workplace',name:'401k',ownerId:'owner-a',type:'traditional-401k',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:true,value:0}}];
  const plan=makeAduPlan({horizonYears:1,openingCashCents:5_000_000,accounts,
   salaries:owners.map(owner=>({id:`salary-${owner}`,name:`Salary ${owner}`,ownerId:`owner-${owner}`,employerId:`employer-${owner}`,annualGrossCents:15_000_000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]})),
   expenses:[{id:'living',name:'Living',amountCents:833_333,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'personal'}],
   cashFlowAllocation:makeAllocationPolicy({entries:[...owners.map((owner,i)=>({id:`max-roth-${owner}`,priority:i+1,destination:{kind:'account' as const,accountId:`roth-ira-${owner}`,backdoorRoth:{traditionalIraAccountId:`traditional-ira-${owner}`,cleanIraHistory:{known:true as const,value:true}}},amount:{kind:'max-annual' as const}})),
    {id:'max-workplace',priority:3,destination:{kind:'account',accountId:'workplace',sponsoringSalaryId:'salary-a'},amount:{kind:'max-annual'}}],overflow:{id:'overflow',destination:{kind:'account',accountId:'brokerage'}}})},
   {ownerFunding:{kind:'taxable-brokerage',accountId:'brokerage'},constructionStartDate:'2026-01-01',completionDate:'2026-06-01',productionPeriod:{known:true,value:{startDate:'2026-01-01',endDate:'2026-06-01',uninterrupted:true}},
    costs:[{id:'building-stage',name:'Building',paymentDate:'2026-06-01',amountCents:10_000_000,category:'building',treatments:makeAduTreatments(10_000_000)}]});
  const before=structuredClone(plan),result=project(plan),year=result.years[0]!,sale=year.brokerageFunding!.sales[0]!;
  for(const amount of [year.totalTaxCents,year.expensesCents,year.cashFlowCents,year.netWorthCents])expect(amount.status).toBe('available');
  expect(year.coverage.completeForModeledScope).toBe(true);
  expect(year.fundingStatus).toBe('conditional-on-gap');expect(sale.shortfallCents).toBeGreaterThan(0);
  expect(sale.grossSaleCents).toBeGreaterThan(5_000_000);expect(sale.basisConsumedCents).toBe(4_500_000);
  expect(sale.constructionFundedCents+sale.shortfallCents).toBe(10_000_000);
  expect(sale.grossSaleCents-sale.federalTaxCents-sale.californiaTaxCents).toBe(sale.constructionFundedCents);
  expect(result.issues.some(issue=>['brokerage-funding-cycle','brokerage-funding-nonconvergence'].includes(issue.code))).toBe(false);
  expect(result.issues.some(issue=>issue.code==='brokerage-funding-deposit-timing')).toBe(true);
  const ledger=year.accounts.find(account=>account.accountId==='brokerage')!;
  expect(aduValue(ledger.withdrawalCents!)).toBe(sale.grossSaleCents);
  for(const month of result.months.slice(0,5))expect(aduValue(month.accounts.find(account=>account.accountId==='brokerage')!.contributionCents)).toBe(0);
  expect(plan).toEqual(before);
 },15000);

 it('transfers existing brokerage assets to construction once without creating income or reducing cash twice',()=>{
  const plan=fundedPlan(),before=structuredClone(plan),result=project(plan),year=result.years[1]!;
  expect(aduValue(year.reserveCents)).toBe(0);
  expect(aduValue(year.accounts[0]!.closingCents)).toBe(10_000_000);
  expect(aduValue(year.accounts[0]!.withdrawalCents!)).toBe(10_000_000);
  expect(aduValue(year.accounts[0]!.closingTaxableBasisCents!)).toBe(10_000_000);
  expect(aduValue(year.grossIncomeCents)).toBe(0);
  expect(aduValue(year.netWorthCents)).toBe(120_000_000);
  expect(year.fundingStatus).toBe('funded');expect(plan).toEqual(before);
 });
 it('grosses up sales using actual incremental federal and California household taxes, reserved at the sale',()=>{
  const plan=fundedPlan(0,{salaries:[{id:'salary',name:'Wages',ownerId:'owner-a',employerId:'employer',annualGrossCents:20_000_000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}]}),result=project(plan),year=result.years[1]!,sales=year.brokerageFunding!.sales;
  expect(sales).toHaveLength(1);const sale=sales[0]!;
  expect(sale.grossSaleCents).toBeGreaterThan(10_000_000);expect(sale.realizedGainCents).toBe(sale.grossSaleCents);
  expect(sale.grossSaleCents-sale.federalTaxCents-sale.californiaTaxCents).toBeGreaterThanOrEqual(10_000_000);
  expect(sale.shortfallCents).toBe(0);expect(sale.residualCents).toBeLessThan(101);
  expect(aduValue(year.accounts[0]!.closingCents)).toBe(20_000_000-sale.grossSaleCents);
  const cashPlan={...plan,properties:plan.properties.map(p=>({...p,aduProject:{...p.aduProject!,ownerFunding:{kind:'household-cash' as const}}}))},cashResult=project(cashPlan);
  const extraTax=aduValue(year.totalTaxCents)-aduValue(cashResult.years[1]!.totalTaxCents);
  expect(sale.federalTaxCents+sale.californiaTaxCents).toBe(extraTax);
  for(let month=0;month<6;month++)expect(result.months[12+month]!.totalTaxCents).toEqual(cashResult.months[12+month]!.totalTaxCents);
  expect(aduValue(year.grossIncomeCents)).toBe(20_000_000);
 });
 it('uses a visible zero-basis assumption for unknown basis without changing saved history',()=>{
  const plan=fundedPlan(null),result=project(plan);
  expect(result.years.every(y=>y.totalTaxCents.status==='available'&&y.netWorthCents.status==='available')).toBe(true);
  expect(result.issues.some(issue=>issue.code==='estimated-brokerage-basis')).toBe(true);
  expect(plan.accounts[0]!.openingTaxableBasis).toBeUndefined();
  expect(result.years[1]!.brokerageFunding!.sales[0]!.grossSaleCents).toBeGreaterThan(10_000_000);
 });
 it('caps a sale to actual funds and reports the uncovered construction amount',()=>{
  const plan=fundedPlan(4_000_000);const result=project({...plan,accounts:plan.accounts.map(a=>({...a,openingBalanceCents:4_000_000}))}),year=result.years[1]!,sale=year.brokerageFunding!.sales[0]!;
  expect(sale.grossSaleCents).toBe(4_000_000);expect(sale.shortfallCents).toBe(6_000_000);
  expect(aduValue(year.accounts[0]!.closingCents)).toBe(0);expect(aduValue(year.reserveCents)).toBe(-6_000_000);
  expect(year.fundingStatus).toBe('conditional-on-gap');expect(year.netWorthCents.status).toBe('available');
 });
 it('marks a selected-account shortfall conditional even when other household cash exists',()=>{
  const plan=fundedPlan(4_000_000,{openingCashCents:50_000_000});const result=project({...plan,accounts:plan.accounts.map(a=>({...a,openingBalanceCents:4_000_000}))});
  expect(result.months.find(m=>m.date==='2027-06')!.conditionalOnGap).toBe(false);
  expect(result.months.find(m=>m.date==='2027-07')!.fundingStatus).toBe('conditional-on-gap');
  expect(result.years[2]!.conditionalOnGap).toBe(true);
 });
 it('sells only the construction portion left after attributed loan proceeds',()=>{
  const plan=fundedPlan(),p=plan.properties[0]!,projectData=p.aduProject!;
  const result=project({...plan,properties:[{...p,aduProject:{...projectData,financing:{id:'project-loan',name:'Build loan',aprBps:0,firstAmortizingPaymentMonth:'2028-01',termMonths:120,collateralPropertyId:p.id,draws:[{id:'loan-draw',month:'2027-07',amountCents:6_000_000,costAllocations:[{costId:'building-stage',amountCents:6_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true}}}}]});
  expect(result.years[1]!.brokerageFunding!.sales[0]!.grossSaleCents).toBe(4_000_000);
  expect(aduValue(result.years[1]!.accounts[0]!.closingCents)).toBe(16_000_000);
  expect(aduValue(result.years[1]!.reserveCents)).toBe(0);
 });
 it('carries one shared account and basis across staged year-boundary payments',()=>{
  const plan=fundedPlan(),p=plan.properties[0]!,projectData=p.aduProject!;
  const stages=[{id:'first',date:'2026-12-15'},{id:'second',date:'2027-07-01'}].map(s=>({...projectData.costs[0]!,id:s.id,paymentDate:s.date,amountCents:5_000_000,treatments:makeAduTreatments(5_000_000)}));
  const result=project({...plan,properties:[{...p,aduProject:{...projectData,constructionStartDate:'2026-12-01',productionPeriod:{known:true,value:{startDate:'2026-12-01',endDate:projectData.completionDate,uninterrupted:true}},costs:stages}}]});
  expect(result.years.slice(0,2).map(y=>aduValue(y.accounts[0]!.closingCents))).toEqual([15_000_000,10_000_000]);
  expect(result.years.slice(0,2).map(y=>aduValue(y.accounts[0]!.closingTaxableBasisCents!))).toEqual([15_000_000,10_000_000]);
  expect(result.years.slice(0,2).map(y=>y.brokerageFunding!.sales[0]!.grossSaleCents)).toEqual([5_000_000,5_000_000]);
 });
 it('shares the account between two properties without double spending its assets or basis',()=>{
  const plan=fundedPlan(),first=plan.properties[0]!,firstProject=first.aduProject!,unit=plan.rentals[0]!;
  const second={...first,id:'second-home',aduProject:{...firstProject,id:'second-project',rentalId:'second-rental',costs:firstProject.costs.map(c=>({...c,id:'second-stage',paymentDate:'2027-07-15'}))}};
  const result=project({...plan,properties:[first,second],rentals:[unit,{...unit,id:'second-rental',propertyId:second.id}]});
  expect(result.years[1]!.brokerageFunding!.sales.map(s=>s.grossSaleCents)).toEqual([10_000_000,10_000_000]);
  expect(aduValue(result.years[1]!.accounts[0]!.closingCents)).toBe(0);expect(aduValue(result.years[1]!.accounts[0]!.closingTaxableBasisCents!)).toBe(0);
  expect(aduValue(result.years[1]!.reserveCents)).toBe(0);
 });
 it('keeps salary allocation unchanged when existing brokerage funds the build',()=>{
  const salary={id:'salary',name:'Wages',ownerId:'owner-a',employerId:'employer',annualGrossCents:10_000_000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]};
  const plan=fundedPlan(20_000_000,{salaries:[salary],cashFlowAllocation:makeAllocationPolicy({overflow:{id:'overflow',destination:{kind:'account',accountId:'brokerage'}}})}),build=project(plan);
  const {aduProject,...home}=plan.properties[0]!,noBuild=project({...plan,properties:[{...home,role:'primary'}],rentals:[]});
  expect(build.years[1]!.eligibleContributionCents).toEqual(noBuild.years[1]!.eligibleContributionCents);
  expect(aduValue(build.years[1]!.reserveCents)).toBe(0);
  expect(aduValue(build.years[1]!.accounts[0]!.closingCents)).toBe(aduValue(noBuild.years[1]!.accounts[0]!.closingCents)-10_000_000);
 });
 it('retains investments in the no-build case and counts owner cost despite the cash transfer',()=>{
  const comparison=aduValue(calculateAduBuildComparison(mustValidate(fundedPlan()),loadRuleSet(),'adu-project'));
  expect(aduValue(comparison.build.years[1]!.accounts[0]!.closingCents)).toBe(10_000_000);
  expect(aduValue(comparison.noBuild.years[1]!.accounts[0]!.closingCents)).toBe(20_000_000);
  expect(aduValue(comparison.ownerCommitmentCents)).toBe(10_000_000);
 });
});
