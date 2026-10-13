import { describe, expect, it } from 'vitest';
import { calculateProjection } from '../../src/engine/projection';
import { loadRuleSet } from '../../src/engine/rules/registry';
import type { CashFlowAllocationEntry, PlanDocument } from '../../src/engine/model/plan';
import type { AnnualProjection } from '../../src/engine/projection-types';
import { MAX_CENTS } from '../../src/engine/money';
import { makeAllocationPlan, makeAllocationPolicy } from '../helpers/allocations';
import { mustValidate } from '../helpers/plans';
import { numericProjectionView } from '../helpers/projection';
import fixtureRows from '../../fixtures/math/projection.json';

const percent=(accountId:string,percentBps:number):CashFlowAllocationEntry=>({id:`percent-${accountId}`,priority:1,destination:accountId==='cash'?{kind:'cash'}:{kind:'account',accountId},amount:{kind:'percent',percentBps}});
function fixture(overrides:Partial<PlanDocument>={}):PlanDocument {
 const base=makeAllocationPlan();
 return {...base,salaries:[{...base.salaries[0]!,annualGrossCents:6000000}],household:{...base.household,filers:[{...base.household.filers[0],workplaceCoverage:{known:true,value:true}},base.household.filers[1]]},cashFlowAllocation:makeAllocationPolicy({entries:[percent('brokerage',2000),percent('cash',2000),{id:'maximum-workplace',priority:2,destination:{kind:'account',accountId:'workplace',sponsoringSalaryId:'salary-a'},amount:{kind:'max-annual'}}],overflow:{id:'excess',destination:{kind:'account',accountId:'brokerage'}}}),...overrides};
}
const project=(document:PlanDocument,rules=loadRuleSet())=>calculateProjection(mustValidate(document),rules);
function money(value:{status:string;value?:number}):number {expect(value.status).toBe('available');return value.value!;}
function report(year:AnnualProjection) {expect(year.cashFlowAllocation?.status).toBe('available');if(year.cashFlowAllocation?.status!=='available')throw new Error('Missing allocation');return year.cashFlowAllocation.value;}
function reconcile(year:AnnualProjection) {
 const r=report(year),withholding=year.rsu?.status==='available'?year.rsu.value.withholdingCents:0;
 expect(r.originalCashFlowCents).toBe(money(year.salaryCents)+money(year.otherIncomeCents)+money(year.rentCents)+withholding-money(year.totalTaxCents)-money(year.expensesCents)-money(year.debtPaymentCents));
 expect(r.accounts.reduce((s,a)=>s+a.actualCents,0)+r.retainedCashCents).toBe(r.originalCashFlowCents);
 expect(money(year.eligibleContributionCents)).toBe(r.accounts.reduce((s,a)=>s+a.actualCents,0));
 expect(money(year.cashFlowCents)).toBe(r.retainedCashCents);
 for(const account of r.accounts)expect(money(year.accounts.find(a=>a.accountId===account.accountId)!.contributionCents)).toBe(account.actualCents);
}

describe('allocation forecasts post only accepted annual funding',()=>{
 it('posts primary and excess once and retains explicit cash using independently derived final taxes',()=>{
  const doc=fixture(),saved=structuredClone(doc),result=project(doc),year=result.years[0]!;
  expect(report(year)).toMatchObject({originalCashFlowCents:5429700,explicitCashCents:1085940,retainedCashCents:1085940});
  expect(money(year.federalIncomeTaxCents)).toBe(33300);expect(money(year.californiaIncomeTaxCents)).toBe(0);
  expect(money(year.accounts.find(a=>a.accountId==='brokerage')!.closingCents)).toBe(1893760);
  expect(money(year.accounts.find(a=>a.accountId==='workplace')!.closingCents)).toBe(2450000);
  expect(money(year.reserveCents)).toBe(1085940);expect(money(year.netWorthCents)).toBe(5429700);
  expect(result.contributionSchedules.filter(s=>s.ruleId==='excess')).toHaveLength(1);
  expect(result.contributionSchedules.reduce((s,c)=>s+(c.requests.status==='available'?c.requests.value.reduce((n,r)=>n+r.requestedCents,0):0),0)).toBe(4343760);
  expect(result.months.every(m=>money(m.reserveCents)>=0)).toBe(true);expect(doc).toEqual(saved);reconcile(year);
 });
 it('recalculates three years of changing salary and legal limits and grows accepted deposits',()=>{
  const doc=fixture({horizonYears:3,taxPolicy:{baselineYear:2026,futureIndexGrowthBps:1000,actualStateTaxPaidByYear:[]}});
  const result=project({...doc,salaries:[{...doc.salaries[0]!,changes:[{date:'2027-01-01',kind:'amount',annualGrossCents:9000000},{date:'2028-01-01',kind:'amount',annualGrossCents:12000000}]}],accounts:doc.accounts.map(a=>a.id==='brokerage'?{...a,annualGrowthBps:1200}:a)});
  expect(result.years.map(y=>money(y.salaryCents))).toEqual([6000000,9000000,12000000]);
  expect(result.years.map(y=>report(y).accounts.find(a=>a.accountId==='workplace')!.maximumCents)).toEqual([2450000,2650000,2950000]);
  let reserve=0,broker=0;
  for(const year of result.years){reconcile(year);reserve+=report(year).retainedCashCents;expect(money(year.reserveCents)).toBe(reserve);const a=year.accounts.find(a=>a.accountId==='brokerage')!;expect(money(a.closingCents)).toBe(broker+money(a.contributionCents)+money(a.growthCents));if(year.year>2026)expect(money(a.growthCents)).toBeGreaterThan(0);broker=money(a.closingCents);}
  // The accepted brokerage schedule funds in December; the next January grows that deposit.
  expect(money(result.years[0]!.accounts.find(a=>a.accountId==='brokerage')!.growthCents)).toBe(0);
  expect(result.months.slice(0,11).every(m=>money(m.accounts.find(a=>a.accountId==='brokerage')!.contributionCents)===0)).toBe(true);
  const january=result.months.find(m=>m.date==='2027-01')!.accounts.find(a=>a.accountId==='brokerage')!;
  // $18,937.60 * ((1.12)^(1/12)-1), rounded to cents = $179.69.
  expect(january).toMatchObject({openingCents:{status:'available',value:1893760},growthCents:{status:'available',value:17969}});
  expect(result.years[1]!.provenance).toContainEqual(expect.objectContaining({applicableYear:2027,status:'projected',sources:expect.any(Array)}));
  expect(result.years[1]!.provenance.some(p=>p.applicableYear===2027&&p.status==='provisional')).toBe(true);
  expect(result.years.every(y=>y.coverage.completeForModeledScope)).toBe(true);
  for(const month of result.months){const a=month.accounts.find(a=>a.accountId==='brokerage')!;expect(money(a.closingCents)).toBe(money(a.openingCents)+money(a.contributionCents)+money(a.growthCents));}
 });
 it('counts every personal debt payment against allocatable cash',()=>{
  const result=project(fixture({debts:[{id:'personal-debt',name:'Debt',openingBalanceCents:1200000,aprBps:0,monthlyPaymentCents:100000,firstPaymentMonth:'2026-01'}]}));
  const year=result.years[0]!;expect(money(year.debtPaymentCents)).toBe(1200000);expect(report(year).originalCashFlowCents).toBe(4229700);reconcile(year);
  expect(report(year).accounts.find(a=>a.accountId==='workplace')!.actualCents).toBe(2450000);
 });
 it('uses real cash and RSU withholding while excluding retained compensation from the allocation pool',()=>{
  const doc=fixture(),grant={id:'grant',name:'Grant',startDate:'2026-06-01',grantValueCents:1000000,grantSharePriceCents:10000,vestingMonths:1,vestingFrequency:'monthly' as const,cliffMonths:0,withholdingBps:3000,taxTreatment:'settle-at-vest' as const,openingHeldShares:0,openingBasis:{known:true as const,value:0}};
  const year=project({...doc,accounts:[...doc.accounts,{id:'equity',name:'Equity',ownerId:'owner-a',type:'rsu',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false},rsu:{employerId:'employer-0',currentSharePriceCents:10000,grants:[grant]}}]}).years[0]!;
  expect(year.rsu?.status).toBe('available');expect(money(year.grossIncomeCents)).toBe(7000000);reconcile(year);
  expect(money(year.accounts.find(a=>a.accountId==='equity')!.closingCents)).toBe(700000);
  expect(report(year).originalCashFlowCents).toBe(6300000-money(year.totalTaxCents));
 });
 it.each([{monthly:100000,status:'funded',existing:1200000},{monthly:500000,status:'funding-conflict',existing:6000000}])('preserves saved $monthly monthly deposits and reports $status',({monthly,status,existing})=>{
  const doc=fixture({openingCashCents:10000000,cashFlowAllocation:makeAllocationPolicy({entries:[percent('brokerage',1000)]}),contributions:[{id:'saved',accountId:'brokerage',priority:0,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:monthly}}]}),result=project(doc),year=result.years[0]!,r=report(year);
  expect(r.status).toBe(status);expect(r.accounts[0]).toMatchObject({existingCents:existing,percentageCents:0,actualCents:existing});
  expect(r.accounts[0]!.reasons.some(i=>i.code==='allocation-existing-above-target')).toBe(true);
  expect(result.contributions.filter(r=>r.ruleId==='saved').every(r=>r.requestedCents===monthly&&money(r.eligibleCents)===monthly)).toBe(true);expect(money(year.reserveCents)).toBe(10000000+r.retainedCashCents);reconcile(year);
 });
 it('reconciles two years of rent, expenses and other cash income independently of account transfers',()=>{
  const sample=fixtureRows.find(f=>f.id==='two-salaries-home-adu')!.input as unknown as PlanDocument;
  const account=sample.accounts.find(a=>a.type==='taxable-brokerage')!;
  const result=project({...sample,horizonYears:2,openingCashCents:123456,cashFlowAllocation:makeAllocationPolicy({entries:[percent(account.id,5000),percent('cash',2000)],overflow:{id:'excess',destination:{kind:'account',accountId:account.id}}})});
  let reserve=123456;
  for(const year of result.years){expect(money(year.rentCents)).toBeGreaterThan(0);expect(money(year.expensesCents)).toBeGreaterThan(0);reconcile(year);reserve+=report(year).retainedCashCents;expect(money(year.reserveCents)).toBe(reserve);}
 });
 it('carries accepted nondeductible basis once per year rather than once per trial',()=>{
  const doc=fixture({horizonYears:2,cashFlowAllocation:makeAllocationPolicy({entries:[{id:'max-ira',priority:1,destination:{kind:'account',accountId:'ira'},amount:{kind:'max-annual'}}]})});
  const result=project({...doc,salaries:[{...doc.salaries[0]!,annualGrossCents:20000000}]});
  expect(result.taxStates.map(s=>s.closing.iraBasisByOwner['owner-a'])).toEqual([{known:true,value:750000},{known:true,value:1500000}]);result.years.forEach(reconcile);
 });
});

describe('availability and independent schedules',()=>{
 it('preserves earlier accepted years when a later tax year is unavailable',()=>{
  const result=project(fixture({horizonYears:2,otherIncome:[{id:'later-overflow',name:'Later income',amountCents:MAX_CENTS,frequency:'monthly',startDate:'2027-01-01',annualGrowthBps:0,classification:'ordinary-taxable',niitTreatment:'included'}]}));
  expect(report(result.years[0]!).originalCashFlowCents).toBe(5429700);
  expect(result.years[1]!.coverage.completeForModeledScope).toBe(false);expect(result.years[1]!.issues.some(i=>i.code==='monetary-overflow')).toBe(true);
  expect(result.years[1]!.cashFlowAllocation?.status).toBe('unsupported-case');expect(result.years[1]!.tax.status).toBe('unsupported-case');
  expect(result.contributionSchedules.find(s=>s.year===2027&&s.ruleId==='maximum-workplace')?.requests.status).toBe('unsupported-case');
  expect(result.contributions.filter(c=>c.year===2027&&c.ruleId==='maximum-workplace')).toHaveLength(0);
 });
 it('recovers independent salaries and deposits when filtering would leave a dangling policy sponsor',()=>{
  const base=fixture();const bad={...base.salaries[0]!,id:'overflow-salary',annualGrossCents:MAX_CENTS};
  const doc={...base,salaries:[...base.salaries,bad],contributions:[{id:'saved',accountId:'ira',priority:1,startDate:'2026-01-01',amount:{kind:'fixed' as const,monthlyCents:0}}],otherIncome:[{id:'overflow-income',name:'Bad income',amountCents:MAX_CENTS,frequency:'monthly' as const,startDate:'2026-01-01',annualGrowthBps:0,classification:'ordinary-taxable' as const,niitTreatment:'included' as const}]};
  const result=project(doc),salary=result.cashSchedules.find(s=>s.recordId==='salary-a')!;
  expect(salary.schedule.status).toBe('available');if(salary.schedule.status==='available')expect(salary.schedule.value.annualCents).toBe(6000000);
  expect(result.years[0]!.cashFlowAllocation?.status).toBe('unsupported-case');
  expect(result.months[0]!.accounts.find(a=>a.accountId==='ira')!.contributionCents).toEqual({status:'available',value:0});
 });
 it('keeps independent salary, payroll, property and saved account schedules when a personal debt blocks allocation',()=>{
  const doc=fixture(),separate={...doc.accounts[0]!,id:'separate'};
  const result=project({...doc,accounts:[...doc.accounts,separate],contributions:[{id:'saved-separate',accountId:'separate',priority:0,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}],debts:[{id:'overflow-debt',name:'Debt',openingBalanceCents:MAX_CENTS,aprBps:1000,monthlyPaymentCents:0,firstPaymentMonth:'2026-01'}],properties:[{id:'home',name:'Home',role:'primary',purchaseDate:'2025-01-01',purchasePriceCents:1000000,downPaymentCents:1000000,openingValueCents:1000000,appreciationBps:0,appreciationOverrides:[],loans:[]}]});
  expect(result.years[0]!.cashFlowAllocation?.status).toBe('unsupported-case');
  expect(money(result.years[0]!.salaryCents)).toBe(6000000);expect(money(result.years[0]!.socialSecurityCents)).toBe(372000);
  expect(money(result.years[0]!.accounts.find(a=>a.accountId==='separate')!.closingCents)).toBe(120000);
  expect(money(result.years[0]!.properties[0]!.closingValueCents)).toBe(1000000);
  expect(result.contributions.every(c=>c.ruleId==='saved-separate')).toBe(true);
  expect(result.loanSchedules[0]!.schedule.status).toBe('unsupported-case');
 });
 it('retains unresolved excess in cash and omits unverified requests from accepted taxes and account deposits',()=>{
  const doc=fixture({cashFlowAllocation:makeAllocationPolicy({entries:[percent('brokerage',1000)],overflow:{id:'unresolved-excess',destination:{kind:'account',accountId:'workplace',sponsoringSalaryId:'salary-a'}}})});
  const result=project({...doc,household:{...doc.household,filers:[{...doc.household.filers[0],birthDate:{known:true,value:'1970-01-01'}},doc.household.filers[1]]}}),year=result.years[0]!;
  expect(report(year)).toMatchObject({originalCashFlowCents:5136800,excessAcceptedCents:0,retainedCashCents:4623120});
  expect(report(year).reasons.some(i=>i.code==='required-employer-history')).toBe(true);
  expect(result.contributionSchedules.find(s=>s.ruleId==='unresolved-excess')?.requests).toEqual({status:'available',value:[]});
  expect(result.contributions.some(c=>c.ruleId==='unresolved-excess')).toBe(false);expect(money(year.accounts.find(a=>a.accountId==='workplace')!.closingCents)).toBe(0);reconcile(year);
 });
 it('does not fund a primary with unresolved legal facts or carry a speculative basis',()=>{
  const doc=fixture({cashFlowAllocation:makeAllocationPolicy({entries:[{id:'max-ira',priority:1,destination:{kind:'account',accountId:'ira'},amount:{kind:'max-annual'}}]})});
  const result=project({...doc,household:{...doc.household,filers:[{...doc.household.filers[0],birthDate:{known:false}},doc.household.filers[1]]}});
  expect(result.years[0]!.cashFlowAllocation?.status).toBe('needs-data');expect(result.years[0]!.accounts.find(a=>a.accountId==='ira')!.closingCents.status).toBe('needs-data');
  expect(result.contributions.filter(c=>c.ruleId==='max-ira')).toHaveLength(0);expect(result.closingTaxState.iraBasisByOwner['owner-a']).toEqual({known:false});
 });
 it.each(fixtureRows)('preserves the no-policy numeric worksheet $id and omits allocation output',fixture=>{
  const result=project(fixture.input as unknown as PlanDocument);
  expect(result.years.every(y=>!('cashFlowAllocation' in y))).toBe(true);
  expect(numericProjectionView(result,fixture.comparisonMode==='selected-numeric-rows'?fixture.expected:undefined)).toEqual(fixture.expected);
 });
});
