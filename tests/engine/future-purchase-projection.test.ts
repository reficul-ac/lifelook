import {describe,expect,it} from 'vitest';
import type {Account,PlanDocument,Property,PropertyLoan,ValidatedPlan} from '../../src/engine/model/plan';
import {calculateProjection} from '../../src/engine/projection';
import {resolveCashYear} from '../../src/engine/cash/income';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {makePlan,mustValidate} from '../helpers/plans';
import {makeAduPlan,makeAduTreatments,aduValue} from '../helpers/adu';
import {makeAllocationPolicy} from '../helpers/allocations';

const brokerage=(overrides:Partial<Account>={}):Account=>({id:'brokerage',name:'Purchase savings',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:20_000_000,annualGrowthBps:0,openingIraBasis:{known:true,value:0},openingTaxableBasis:{known:true,value:20_000_000},...overrides});
const home=(overrides:Partial<Property>={}):Property=>({id:'future-home',name:'Future home',role:'primary',purchaseDate:'2027-06-15',purchasePriceCents:10_000_000,downPaymentCents:10_000_000,openingValueCents:10_000_000,appreciationBps:0,appreciationOverrides:[],loans:[],...overrides});
const project=(plan:PlanDocument)=>calculateProjection(mustValidate(plan),loadRuleSet());
const month=(result:ReturnType<typeof project>,date:string)=>result.months.find(m=>m.date===date)!;

describe('future property purchases in the household forecast',()=>{
 it('posts the home at closing and charges cash once without inventing income or appreciation',()=>{
  const plan=makePlan({horizonYears:3,openingCashCents:20_000_000,properties:[home({appreciationBps:1200})]}),before=structuredClone(plan),result=project(plan);
  for(const m of result.months.filter(m=>m.date<'2027-06'))expect(aduValue(m.propertyValueCents)).toBe(0);
  const closing=month(result,'2027-06');
  expect(aduValue(closing.propertyValueCents)).toBe(10_000_000);
  expect(aduValue(closing.propertyGrowthCents)).toBe(0);
  expect(aduValue(closing.expensesCents)).toBe(10_000_000);
  expect(aduValue(closing.reserveCents)).toBe(10_000_000);
  expect(aduValue(closing.netWorthCents)).toBe(20_000_000);
  expect(aduValue(month(result,'2027-07').propertyValueCents)).toBeGreaterThan(10_000_000);
  expect(aduValue(result.years[1]!.expensesCents)).toBe(10_000_000);
  expect(aduValue(result.years[2]!.expensesCents)).toBe(0);
  expect(result.years.every(y=>aduValue(y.grossIncomeCents)===0)).toBe(true);
  expect(plan).toEqual(before);
 });

 it('activates a future purchase mortgage after pre-closing years and keeps only the down payment in cash costs',()=>{
  const loan:PropertyLoan={id:'purchase-loan',name:'Purchase mortgage',originalPrincipalCents:64_000_000,aprBps:0,originationDate:'2028-01-02',acquisitionDate:'2028-01-02',termMonths:360,firstPaymentDate:'2028-02-29',openingBalance:{known:false},openingPayment:{known:false},collateralPropertyId:'future-home',proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:{known:true,value:true},qualifiedPrincipalCents:{known:true,value:64_000_000},historyComplete:{known:true,value:true}},proceedsAllocations:[{propertyId:'future-home',use:'personal',share:{numerator:1,denominator:1}}],financingAtRiskQualification:{known:true,value:true}};
  const result=project(makePlan({horizonYears:4,openingCashCents:16_000_000,properties:[home({purchaseDate:'2028-01-02',purchasePriceCents:80_000_000,downPaymentCents:16_000_000,openingValueCents:80_000_000,loans:[loan]})]}));
  for(const m of result.months.filter(m=>m.date<'2028-01'))expect(aduValue(m.loanBalanceCents)).toBe(0);
  const closing=month(result,'2028-01');
  expect(aduValue(closing.loanBalanceCents)).toBe(64_000_000);
  expect(aduValue(closing.expensesCents)).toBe(16_000_000);
  expect(aduValue(closing.equityCents)).toBe(16_000_000);
  expect(aduValue(closing.reserveCents)).toBe(0);
  expect(aduValue(month(result,'2028-02').loanBalanceCents)).toBeLessThan(64_000_000);
  expect(aduValue(month(result,'2029-01').loanBalanceCents)).toBeGreaterThan(0);
 });

 it('sells the selected brokerage for a down payment once and preserves remaining basis',()=>{
  const future=Object.assign(home(),{purchaseFunding:{kind:'taxable-brokerage',accountId:'brokerage'}});
  const result=project(makePlan({horizonYears:3,accounts:[brokerage()],properties:[future]})),closing=month(result,'2027-06'),sales=closing.brokerageFunding!.sales;
  expect(sales).toHaveLength(1);expect(sales[0]).toMatchObject({propertyId:'future-home',purpose:'property-down-payment',grossSaleCents:10_000_000,constructionFundedCents:10_000_000,shortfallCents:0});
  expect(aduValue(closing.accounts[0]!.closingCents)).toBe(10_000_000);
  expect(aduValue(closing.accounts[0]!.closingTaxableBasisCents!)).toBe(10_000_000);
  expect(aduValue(closing.reserveCents)).toBe(0);
  expect(aduValue(closing.netWorthCents)).toBe(20_000_000);
  expect(aduValue(closing.grossIncomeCents)).toBe(0);
  expect(result.months.flatMap(m=>m.brokerageFunding?.sales??[])).toHaveLength(1);
 });

 it('grosses a purchase sale up for its incremental taxes and carries lower investment growth',()=>{
  const future=Object.assign(home(),{purchaseFunding:{kind:'taxable-brokerage',accountId:'brokerage'}});
  const salary={id:'salary',name:'Wages',ownerId:'owner-a',employerId:'employer',annualGrossCents:20_000_000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]};
  const plan=makePlan({horizonYears:3,salaries:[salary],accounts:[brokerage({annualGrowthBps:600,openingTaxableBasis:{known:true,value:0}})],properties:[future]}),result=project(plan),cash=project({...plan,properties:[home()]}),closing=month(result,'2027-06'),sale=closing.brokerageFunding!.sales[0]!;
  expect(sale.grossSaleCents).toBeGreaterThan(10_000_000);
  expect(sale.grossSaleCents-sale.federalTaxCents-sale.californiaTaxCents).toBeGreaterThanOrEqual(10_000_000);
  expect(sale.federalTaxCents+sale.californiaTaxCents).toBe(aduValue(result.years[1]!.totalTaxCents)-aduValue(cash.years[1]!.totalTaxCents));
  expect(aduValue(month(result,'2027-07').accountGrowthCents)).toBeLessThan(aduValue(month(cash,'2027-07').accountGrowthCents));
  expect(aduValue(result.years[1]!.grossIncomeCents)).toBe(20_000_000);
 });

 it('reports a numeric selected-account funding gap even when household cash is sufficient',()=>{
  const future=Object.assign(home(),{purchaseFunding:{kind:'taxable-brokerage',accountId:'brokerage'}});
  const result=project(makePlan({horizonYears:2,openingCashCents:20_000_000,accounts:[brokerage({openingBalanceCents:4_000_000,openingTaxableBasis:{known:true,value:4_000_000}})],properties:[future]})),closing=month(result,'2027-06');
  expect(closing.brokerageFunding!.sales[0]!.shortfallCents).toBe(6_000_000);
  expect(closing.fundingStatus).toBe('conditional-on-gap');
  expect(aduValue(closing.reserveCents)).toBe(14_000_000);
  expect(result.issues).toContainEqual(expect.objectContaining({recordId:'future-home',field:'purchaseFunding',code:'brokerage-funding-shortfall'}));
  expect(result.years.every(y=>y.netWorthCents.status==='available')).toBe(true);
 });

 it('shares a brokerage ledger between an ADU and a later purchase without spending funds twice',()=>{
  const plan=makeAduPlan({horizonYears:2,openingCashCents:0,accounts:[brokerage()]},{ownerFunding:{kind:'taxable-brokerage',accountId:'brokerage'},costs:[{id:'building-stage',name:'Build',paymentDate:'2027-07-01',amountCents:15_000_000,category:'building',treatments:makeAduTreatments(15_000_000)}]});
  const future=Object.assign(home({purchaseDate:'2027-07-15'}),{purchaseFunding:{kind:'taxable-brokerage',accountId:'brokerage'}});
  const result=project({...plan,properties:[...plan.properties,future]}),closing=month(result,'2027-07'),sales=closing.brokerageFunding!.sales;
  expect(sales.map(s=>s.grossSaleCents)).toEqual([15_000_000,5_000_000]);
  expect(sales[1]!.shortfallCents).toBe(5_000_000);
  expect(aduValue(closing.accounts[0]!.closingCents)).toBe(0);
  expect(aduValue(closing.accounts[0]!.closingTaxableBasisCents!)).toBe(0);
  expect(aduValue(closing.reserveCents)).toBe(-5_000_000);
 });

 it('deducts cash down payments from automatic saving budgets without a funding loop',()=>{
  const salary={id:'salary',name:'Salary',ownerId:'owner-a',employerId:'employer',annualGrossCents:12_000_000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]};
  const plan=makePlan({horizonYears:2,openingCashCents:20_000_000,salaries:[salary],accounts:[brokerage()],cashFlowAllocation:makeAllocationPolicy({overflow:{id:'overflow',destination:{kind:'account',accountId:'brokerage'}}}),properties:[home()]});
  const result=project(plan),without=project({...plan,properties:[]});
  expect(aduValue(result.years[1]!.eligibleContributionCents)).toBeLessThan(aduValue(without.years[1]!.eligibleContributionCents));
  expect(result.years.every(y=>y.netWorthCents.status==='available')).toBe(true);
  expect(result.issues.some(i=>i.code.includes('nonconvergence')||i.code.includes('funding-cycle'))).toBe(false);
 });

 it('clips recurring property expenses and rental receipts to ownership while preserving growth anchors',()=>{
  const adu=makeAduPlan(),rental={...adu.rentals[0]!,id:'future-rental',propertyId:'future-home',rentStartDate:'2026-01-01',availableDate:'2026-01-01',monthlyRentCents:100_000,rentGrowthBps:1000};
  const plan=makePlan({horizonYears:2,properties:[home({role:'rental'})],rentals:[rental],expenses:[{id:'operating',name:'Operating',propertyId:'future-home',amountCents:100_000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:1000,use:'rental',rentalId:'future-rental',taxCategory:'operating'}]});
  const cash=resolveCashYear(plan as ValidatedPlan,2027),rent=cash.streams.find(s=>s.id==='future-rental')!,expense=cash.streams.find(s=>s.id==='operating')!;
  expect(rent.months.slice(0,5)).toEqual([0,0,0,0,0]);
  expect(expense.months.slice(0,5)).toEqual([0,0,0,0,0]);
  expect(rent.months[5]).toBe(58_667);expect(expense.months[5]).toBe(110_000);
 });
});
