import { describe, expect, it } from 'vitest';
import { resolveAllocationYear, type AllocationYearInput } from '../../src/engine/cash/cash-flow-allocation';
import { resolveHouseholdYear } from '../../src/engine/tax/comparison';
import { resolveCashYear } from '../../src/engine/cash/income';
import { requestContributions } from '../../src/engine/cash/contribution-requests';
import { buildPropertyFacts } from '../../src/engine/property/facts';
import { initialTaxState } from '../../src/engine/model/tax-state';
import { loadRuleSet } from '../../src/engine/rules/registry';
import { resolveYearRules } from '../../src/engine/rules/projection';
import type { CashFlowAllocationEntry, PlanDocument } from '../../src/engine/model/plan';
import { makeAllocationPlan, makeAllocationPolicy } from '../helpers/allocations';
import { mustValidate } from '../helpers/plans';
const account = (id: string) => ({kind:'account' as const, accountId:id, ...(id.includes('workplace')?{sponsoringSalaryId:'salary-a'}:{})});
const percent = (id:string,bps:number,priority=1):CashFlowAllocationEntry => ({id:`entry-${id}`,priority,destination:id==='cash'?{kind:'cash'}:account(id),amount:{kind:'percent',percentBps:bps}});
const maximum = (id:string,priority=2):CashFlowAllocationEntry => ({id:`entry-${id}`,priority,destination:account(id),amount:{kind:'max-annual'}});
function fixture(entries:readonly CashFlowAllocationEntry[], overflow='cash', overrides:Partial<PlanDocument>={}):AllocationYearInput {
 const base=makeAllocationPlan();
 const plan=mustValidate({...base, household:{...base.household,filers:[{...base.household.filers[0],workplaceCoverage:{known:true,value:true}},base.household.filers[1]]}, salaries:[{...base.salaries[0]!,annualGrossCents:6000000}],cashFlowAllocation:makeAllocationPolicy({entries,overflow:{id:'overflow',destination:overflow==='cash'?{kind:'cash'}:account(overflow)}}),...overrides});
 const cash=resolveCashYear(plan,plan.startYear),opening=initialTaxState(plan),rules=resolveYearRules(loadRuleSet(),plan.startYear,plan.taxPolicy);
 if(rules.status!=='available')throw new Error('rules');
 return {plan,cash,opening,rules:rules.value,legacyRequests:requestContributions(plan,cash),property:buildPropertyFacts(plan,cash,[],opening,rules.value),loans:[],cashIncomeByMonth:cash.months.map(m=>m.grossIncomeCents),expensesByMonth:cash.months.map(m=>m.expensesCents),debtPaymentsByMonth:Array(12).fill(0),rsuWithholdingByMonth:Array(12).fill(0),taxWeightsByMonth:cash.positiveGrossCashByMonth};
}
function resolved(input:AllocationYearInput,evaluate=resolveHouseholdYear) {
 const result=resolveAllocationYear(input,evaluate);expect(result.status,JSON.stringify(result)).toBe('available');
 if(result.status!=='available')throw new Error(JSON.stringify(result));return result.value;
}
const sum=(values:readonly number[])=>values.reduce((a,b)=>a+b,0);
// Students in these fictional cases cannot claim Saver's Credit. Independent arithmetic: tax-fixture-worksheet.md.
describe('annual allocation and coupled taxes',()=>{
 it('recomputes the common denominator after maximum traditional deferrals and aggregates brokerage excess',()=>{
  const input=fixture([percent('brokerage',2000),percent('cash',2000),maximum('workplace')],'brokerage');
  const opening=structuredClone(input.opening),r=resolved(input);
  expect(r.report.originalCashFlowCents).toBe(5429700);
  expect(r.report.accounts.find(a=>a.accountId==='workplace')).toMatchObject({targetCents:2450000,maximumCents:2450000,actualCents:2450000});
  expect(r.report.accounts.find(a=>a.accountId==='brokerage')).toMatchObject({targetCents:1085940,percentageCents:1085940,excessCents:807820,actualCents:1893760});
  expect(r.report).toMatchObject({explicitCashCents:1085940,retainedCashCents:1085940,excessAcceptedCents:807820,excessRetainedCents:0});
  expect(sum(r.incomeTaxByMonth)).toBe(33300);expect(input.opening).toEqual(opening);
  expect(r.household.tax.status==='available'&&r.household.tax.value.california.totalCents).toBe(0);
  expect(sum(r.report.accounts.map(a=>a.actualCents))+r.report.retainedCashCents).toBe(5429700);
  let balance=0;for(let m=1;m<=12;m++){balance+=r.preTransferCashByMonth[m-1]!-sum(r.household.contributions.filter(c=>c.month===m).map(c=>c.eligibleCents.status==='available'?c.eligibleCents.value:0));expect(balance).toBeGreaterThanOrEqual(0);}
 });
 it.each(['excess','percent'])('solves traditional %s tax feedback from the identical opening state',mode=>{
  const r=resolved(fixture([percent('brokerage',5000),percent('cash',2000),...(mode==='percent'?[percent('workplace',3000)]:[])],mode==='excess'?'workplace':'cash'));
  expect(r.report.originalCashFlowCents).toBe(5335300);expect(sum(r.incomeTaxByMonth)).toBe(127700);
  expect(r.report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(1600590);
  expect(r.report.accounts.find(a=>a.accountId==='brokerage')?.actualCents).toBe(2667650);
  expect(r.report.retainedCashCents).toBe(1067060);
 });
 it('counts eligible saved deposits toward total percentage targets without moving their dates',()=>{
  const input=fixture([percent('brokerage',1000)],'cash',{contributions:[{id:'saved',accountId:'brokerage',priority:1,startDate:'2026-09-01',amount:{kind:'fixed',monthlyCents:100000}}]});
  const r=resolved({...input,cashIncomeByMonth:months(10000000),expensesByMonth:Array(12).fill(0)},zeroTaxes);
  expect(r.report.accounts[0]).toMatchObject({targetCents:1000000,existingCents:400000,percentageCents:600000,actualCents:1000000});
  expect(r.requests.filter(q=>q.ruleId==='saved')).toEqual(input.legacyRequests);
 });
 it('rejects a cycling evaluator and never carries a trial closing state forward',()=>{
  const input=fixture([percent('brokerage',1000)]);let n=0;
  const result=resolveAllocationYear(input,(...args)=>{expect(args[5]).toBe(input.opening);const h=zeroTaxes(...args);n++;return {...h,tax:h.tax.status==='available'?{status:'available',value:{...h.tax.value,combinedIncomeTaxCents:n%2?100:200,federal:{...h.tax.value.federal,totalCents:n%2?100:200}}}:h.tax};});
  expect(result.status).toBe('unsupported-case');if(result.status!=='available')expect(result.issues[0]?.code).toBe('allocation-nonconvergence');expect(n).toBeLessThan(10);
 });
});
const zeroTaxes:typeof resolveHouseholdYear=(...args)=>{
 const h=resolveHouseholdYear(...args);if(h.tax.status!=='available')return h;
 return {...h,payroll:{...h.payroll,months:h.payroll.months.map(m=>({...m,totalCents:0})),annual:{...h.payroll.annual,totalCents:0}},tax:{status:'available',value:{...h.tax.value,combinedIncomeTaxCents:0,federal:{...h.tax.value.federal,totalCents:0},california:{...h.tax.value.california,totalCents:0}}}};
};

function months(total:number):number[] {return Array.from({length:12},(_,i)=>Math.floor(total*(i+1)/12)-Math.floor(total*i/12));}
function syntheticCash(input:AllocationYearInput,total:number):AllocationYearInput {return {...input,cashIncomeByMonth:months(total),expensesByMonth:Array(12).fill(0)};}
describe('annual stage reservations',()=>{
 it.each([{year:2026,total:10000000,target:9300000,excess:0},{year:2027,total:20000000,target:18600000,excess:700000}])('recalculates the approved synthetic $7,000 illustration in $year',({year,total,target,excess})=>{
  const input=fixture([percent('brokerage',9300),maximum('ira')],'brokerage',{startYear:year});
  const r=resolved({...syntheticCash(input,total),rules:{...input.rules,retirement:{...input.rules.retirement,iraLimitCents:700000}}},zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='brokerage')).toMatchObject({targetCents:target,percentageCents:target,excessCents:excess});
  expect(r.report.accounts.find(a=>a.accountId==='ira')?.maximumCents).toBe(700000);
  expect(r.report.excessAcceptedCents).toBe(excess);
 });
 it('retains 400,000 cents when excess of 600,000 has only 200,000 capacity',()=>{
  const input=fixture([],'ira');const r=resolved({...syntheticCash(input,600000),rules:{...input.rules,retirement:{...input.rules.retirement,iraLimitCents:200000}}},zeroTaxes);
  expect(r.report).toMatchObject({excessOfferedCents:600000,excessAcceptedCents:200000,excessRetainedCents:400000,retainedCashCents:400000});
  expect(r.report.reasons.length).toBeGreaterThan(0);
  expect(r.report.reasons.some(reason=>reason.code==='allocation-cash-shortfall')).toBe(false);
 });
 it('funds only 20% of a synthetic 30% maximum after an 80% primary',()=>{
  const input=fixture([percent('brokerage',8000),maximum('ira')]);
  const r=resolved({...syntheticCash(input,1000000),rules:{...input.rules,retirement:{...input.rules.retirement,iraLimitCents:300000}}},zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='ira')).toMatchObject({targetCents:300000,maximumCents:200000,shortfallCents:100000});
  expect(r.report.status).toBe('funded');
  expect(r.report.accounts.find(a=>a.accountId==='brokerage')?.actualCents).toBe(800000);
  expect(r.report.retainedCashCents).toBe(0);
 });
 it('reports a legally capped percentage as known partial funding in a reconciled pool',()=>{
  const input=fixture([percent('ira',10000)]);
  const r=resolved({...syntheticCash(input,1000000),rules:{...input.rules,retirement:{...input.rules.retirement,iraLimitCents:300000}}},zeroTaxes);
  expect(r.report).toMatchObject({status:'funded',originalCashFlowCents:1000000,retainedCashCents:700000});
  expect(r.report.accounts[0]).toMatchObject({targetCents:1000000,percentageCents:300000,actualCents:300000,shortfallCents:700000});
  expect(r.report.accounts[0]!.reasons.some(issue=>issue.code==='ira-contribution-capped')).toBe(true);
 });
 it('reports an explicit cash shortfall after saved deposits without classifying a legacy conflict',()=>{
  const input=fixture([percent('cash',5000)],'cash',{contributions:[{id:'saved',accountId:'brokerage',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:60000}}]});
  const r=resolved(syntheticCash(input,1000000),zeroTaxes);
  expect(r.report).toMatchObject({status:'funded',originalCashFlowCents:1000000,explicitCashCents:280000,retainedCashCents:280000,excessAcceptedCents:0});
  expect(r.report.accounts[0]).toMatchObject({existingCents:720000,actualCents:720000,percentageCents:0});
 });
 it('reserves a December legacy IRA before January excess can use the shared owner cap',()=>{
  const base=makeAllocationPlan();const roth={...base.accounts[1]!,id:'roth',type:'roth-ira' as const};
  const input=fixture([],'roth',{accounts:[...base.accounts,roth],contributions:[{id:'december',accountId:'ira',priority:99,startDate:'2026-12-01',amount:{kind:'fixed',monthlyCents:500000}}]});
  const r=resolved(syntheticCash(input,2000000),zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='ira')?.existingCents).toBe(500000);
  expect(r.report.accounts.find(a=>a.accountId==='roth')?.excessCents).toBe(250000);
  expect(r.household.contributions.find(c=>c.ruleId==='december'&&c.month===12)?.eligibleCents).toEqual({status:'available',value:500000});
 });
 it('protects primary IRA compensation against traditional workplace excess',()=>{
  const base=makeAllocationPlan();const input=fixture([maximum('ira')],'workplace',{salaries:[{...base.salaries[0]!,annualGrossCents:1000000}]});
  const r=resolved(syntheticCash(input,2000000),zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='ira')?.maximumCents).toBe(750000);
  expect(r.report.accounts.find(a=>a.accountId==='workplace')?.excessCents).toBe(250000);
  expect(r.report.retainedCashCents).toBe(1000000);
 });
 it('uses maximum priority for shared traditional and Roth workplace capacity',()=>{
  const base=makeAllocationPlan(),roth={...base.accounts[2]!,id:'workplace-roth',type:'roth-401k' as const};
  const r=resolved(syntheticCash(fixture([maximum('workplace-roth',2),maximum('workplace',1)],'cash',{accounts:[...base.accounts,roth]}),5000000),zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(2450000);
  expect(r.report.accounts.find(a=>a.accountId==='workplace-roth')?.actualCents).toBe(0);
 });
 it.each([{year:2026,wages:20000000,traditional:2450000,roth:800000},{year:2027,wages:0,traditional:3250000,roth:0}])('uses employer facts for $year and mandatory Roth catch up',({year,wages,traditional,roth})=>{
  const base=makeAllocationPlan(),extra={...base.accounts[2]!,id:'workplace-roth',type:'roth-401k' as const};
  const input=fixture([maximum('workplace',1),maximum('workplace-roth',2)],'cash',{startYear:year,accounts:[...base.accounts,extra],household:{...base.household,filers:[{...base.household.filers[0],birthDate:{known:true,value:'1970-01-01'},workplaceCoverage:{known:true,value:true},employerAssumptionsByYear:[{year:2026,employerId:'employer-0',priorYearWagesCents:{known:true,value:20000000},planCatchUpAvailable:{known:true,value:true},rothCatchUpAvailable:{known:true,value:true}},{year:2027,employerId:'employer-0',priorYearWagesCents:{known:true,value:wages},planCatchUpAvailable:{known:true,value:true},rothCatchUpAvailable:{known:true,value:true}}]},base.household.filers[1]]}});
  const r=resolved(syntheticCash(input,5000000),zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(traditional);
  expect(r.report.accounts.find(a=>a.accountId==='workplace-roth')?.actualCents).toBe(roth);
 });
 it.each([{gross:24200000,want:750000},{gross:24700000,want:375000},{gross:25200000,want:0}])('uses sourced Roth phaseout at $gross cents',({gross,want})=>{
  const base=makeAllocationPlan(),roth={...base.accounts[1]!,id:'roth',type:'roth-ira' as const};
  const input=fixture([maximum('roth')],'cash',{accounts:[...base.accounts,roth],salaries:[{...base.salaries[0]!,annualGrossCents:gross}]});
  expect(resolved(input).report.accounts.find(a=>a.accountId==='roth')?.actualCents).toBe(want);
 });
 it('omits unresolved excess from accepted tax and carries its history issue in the report',()=>{
  const base=makeAllocationPlan();const input=fixture([percent('brokerage',1000)],'workplace',{household:{...base.household,filers:[{...base.household.filers[0],birthDate:{known:true,value:'1970-01-01'},workplaceCoverage:{known:true,value:true}},base.household.filers[1]]}});
  const r=resolved(input);expect(r.report.excessAcceptedCents).toBe(0);expect(r.requests.some(q=>q.ruleId==='overflow')).toBe(false);
  expect(r.report.reasons.some(i=>i.code==='required-employer-history')).toBe(true);
  expect(r.household.tax.status==='available'&&r.household.tax.value.combinedIncomeTaxCents).toBe(326200);
 });
 it('returns unavailable for missing primary age and does not silently use a zero contribution',()=>{
  const base=makeAllocationPlan();const input=fixture([maximum('ira')],'cash',{household:{...base.household,filers:[{...base.household.filers[0],birthDate:{known:false}},base.household.filers[1]]}});
  expect(resolveAllocationYear(input).status).toBe('needs-data');
 });
 it('bounds distinct nonstable tax states at 128 passes',()=>{
  const input=fixture([percent('brokerage',1000)]);let calls=0;
  const result=resolveAllocationYear(input,(...args)=>{const h=zeroTaxes(...args);calls++;if(h.tax.status!=='available')return h;return {...h,tax:{status:'available',value:{...h.tax.value,combinedIncomeTaxCents:calls,federal:{...h.tax.value.federal,totalCents:calls}}}};});
  expect(result.status).toBe('unsupported-case');expect(calls).toBe(129);
 });
 it('does not accept a state whose final verification changes',()=>{
  const input=fixture([percent('brokerage',1000)]);let calls=0;
  const result=resolveAllocationYear(input,(...args)=>{const h=zeroTaxes(...args);calls++;if(calls<4||h.tax.status!=='available')return h;return {...h,tax:{status:'available',value:{...h.tax.value,combinedIncomeTaxCents:1,federal:{...h.tax.value.federal,totalCents:1}}}};});
  expect(result.status).toBe('unsupported-case');expect(calls).toBe(4);
 });
 it('preserves an intentional legacy gap and blocks new deposits against opening reserves',()=>{
  const input=fixture([percent('brokerage',5000)],'ira',{openingCashCents:9999999,contributions:[{id:'saved',accountId:'brokerage',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100000}}]});
  const r=resolved(syntheticCash(input,1000000),zeroTaxes);
  expect(r.report).toMatchObject({status:'funding-conflict',retainedCashCents:-200000,excessAcceptedCents:0});
  expect(r.report.accounts.find(a=>a.accountId==='brokerage')).toMatchObject({existingCents:1200000,percentageCents:0});
 });
 it('reports no numeric shares and no new deposits for a negative annual total',()=>{
  const input=fixture([percent('brokerage',5000)],'ira');const r=resolved({...syntheticCash(input,0),expensesByMonth:months(10000)},zeroTaxes);
  expect(r.report.status).toBe('no-surplus');expect(r.requests).toEqual([]);expect(r.report.accounts[0]?.share.status).toBe('unsupported-case');
 });
});

describe('monthly legal feasibility and disclosures',()=>{
 function catchupFixture() {
  const base=makeAllocationPlan(),roth={...base.accounts[2]!,id:'workplace-roth',type:'roth-401k' as const};
  return fixture([maximum('workplace',1),maximum('workplace-roth',2)],'cash',{accounts:[...base.accounts,roth],household:{...base.household,filers:[{...base.household.filers[0],birthDate:{known:true,value:'1970-01-01'},workplaceCoverage:{known:true,value:true},employerAssumptionsByYear:[{year:2026,employerId:'employer-0',priorYearWagesCents:{known:true,value:20000000},planCatchUpAvailable:{known:true,value:true},rothCatchUpAvailable:{known:true,value:true}}]},base.household.filers[1]]}});
 }
 it('retains separated wage months while scheduling traditional regular funding before Roth catch-up',()=>{
  const input=catchupFixture(),wages=[1000000,1000000,0,0,1000000,0,0,0,0,0,1000000,1000000];
  const r=resolved({...input,cash:{...input.cash,wages:input.cash.wages.map(w=>({...w,annualCents:5000000,monthlyCents:wages}))},cashIncomeByMonth:wages},zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(2450000);
  expect(r.report.accounts.find(a=>a.accountId==='workplace-roth')?.actualCents).toBe(800000);
  for(let m=1;m<=12;m++)expect(sum(r.requests.filter(q=>q.month===m).map(q=>q.requestedCents))).toBeLessThanOrEqual(wages[m-1]!);
 });
 it('does not shift Roth catch-up into months whose cash is reserved for a later deficit',()=>{
  const input=catchupFixture(),wages=[1000000,1000000,0,0,1000000,0,0,0,0,0,1000000,1000000];
  const r=resolved({...input,cash:{...input.cash,wages:input.cash.wages.map(w=>({...w,annualCents:5000000,monthlyCents:wages}))},cashIncomeByMonth:wages,expensesByMonth:[0,0,0,0,0,0,0,0,0,0,0,2000000]},zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(2450000);
  expect(r.report.accounts.find(a=>a.accountId==='workplace-roth')?.actualCents).toBe(550000);
  let cash=0;for(let m=1;m<=12;m++){cash+=r.preTransferCashByMonth[m-1]!-sum(r.requests.filter(q=>q.month===m).map(q=>q.requestedCents));expect(cash).toBeGreaterThanOrEqual(0);}
  expect(r.report.retainedCashCents).toBe(0);
 });
 it('explains refused excess when cash arrives after sponsoring wages end',()=>{
  const base=makeAllocationPlan(),input=fixture([],'workplace',{salaries:[{...base.salaries[0]!,endDate:'2026-06-30'}]});
  const r=resolved({...input,cashIncomeByMonth:[0,0,0,0,0,0,0,0,0,0,0,1000000]},zeroTaxes);
  expect(r.report.excessAcceptedCents).toBe(0);expect(r.report.excessRetainedCents).toBe(1000000);
  expect(r.report.reasons.some(reason=>reason.code==='allocation-compensation-timing')).toBe(true);
 });
 it('explains saved deposits above target without changing the configured target',()=>{
  const input=fixture([percent('brokerage',1000)],'cash',{contributions:[{id:'saved',accountId:'brokerage',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100000}}]});
  const r=resolved(syntheticCash(input,5000000),zeroTaxes);
  expect(r.report.accounts[0]).toMatchObject({targetCents:500000,existingCents:1200000,percentageCents:0});
  expect(r.report.accounts[0]?.reasons.some(reason=>reason.code==='allocation-existing-above-target')).toBe(true);
 });
});

describe('accepted tax state and availability',()=>{
 it('carries nondeductible IRA basis exactly once after repeated tax trials',()=>{
  const base=makeAllocationPlan();const input=fixture([maximum('ira')],'cash',{salaries:[{...base.salaries[0]!,annualGrossCents:20000000}]});
  const opening=structuredClone(input.opening),r=resolved(input);
  expect(r.household.ira.owners.find(o=>o.ownerId==='owner-a')?.newBasisCents).toEqual({status:'available',value:750000});
  expect(r.household.closingTaxState.iraBasisByOwner['owner-a']).toEqual({known:true,value:750000});
  expect(input.opening).toEqual(opening);
 });
 it.each(['tax','contribution'])('inspects unavailable %s values inside a returned household',kind=>{
  const input=fixture([percent('brokerage',5000)]);
  const result=resolveAllocationYear(input,(...args)=>{
   const h=resolveHouseholdYear(...args),unavailable={status:'needs-data' as const,issues:[{code:'fixture-missing',severity:'warning' as const,explanation:'Missing test input.',resolution:'Supply the input.'}]};
   return kind==='tax'?{...h,tax:unavailable}:{...h,contributions:h.contributions.map(c=>({...c,eligibleCents:unavailable}))};
  });
  expect(result.status).toBe('needs-data');if(result.status!=='available')expect(result.issues.some(i=>i.code==='fixture-missing')).toBe(true);
 });
});

describe('eligibility from final traditional deferrals',()=>{
 it.each([{cash:5000000,roth:750000,traditional:2450000},{cash:500000,roth:0,traditional:500000}])('resolves a primary Roth maximum from final lower-stage deductions with $cash cents cash',({cash,roth,traditional})=>{
  const base=makeAllocationPlan(),extra={...base.accounts[1]!,id:'roth',type:'roth-ira' as const};
  const input=fixture([maximum('roth',1),maximum('workplace',2)],'cash',{accounts:[...base.accounts,extra],salaries:[{...base.salaries[0]!,annualGrossCents:26000000}]});
  const r=resolved(syntheticCash(input,cash),zeroTaxes);
  expect(r.report.accounts.find(a=>a.accountId==='roth')?.actualCents).toBe(roth);
  expect(r.report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(traditional);
  expect(r.household.contributions.every(c=>c.eligibleCents.status==='available'&&c.eligibleCents.value===c.requestedCents)).toBe(true);
 });
});

it('recomputes eligible saved Roth deposits when final traditional deferrals restore their capacity',()=>{
 const base=makeAllocationPlan(),roth={...base.accounts[1]!,id:'roth',type:'roth-ira' as const};
 const input=fixture([percent('brokerage',2000),maximum('workplace')],'cash',{accounts:[...base.accounts,roth],salaries:[{...base.salaries[0]!,annualGrossCents:26000000}],contributions:[{id:'saved-roth',accountId:'roth',priority:99,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:50000}}]});
 const r=resolved(syntheticCash(input,5000000),zeroTaxes);
 expect(r.report.accounts.find(a=>a.accountId==='roth')).toMatchObject({existingCents:600000,actualCents:600000});
 expect(r.report.accounts.find(a=>a.accountId==='brokerage')?.percentageCents).toBe(1000000);
 expect(r.report.accounts.find(a=>a.accountId==='workplace')?.maximumCents).toBe(2450000);
 expect(r.report.retainedCashCents).toBe(950000);
 expect(r.requests.filter(q=>q.ruleId==='saved-roth')).toEqual(input.legacyRequests);
});

it('subtracts restored saved Roth funding from its primary top-up exactly once',()=>{
 const base=makeAllocationPlan(),roth={...base.accounts[1]!,id:'roth',type:'roth-ira' as const};
 const input=fixture([percent('roth',1500),maximum('workplace')],'cash',{accounts:[...base.accounts,roth],salaries:[{...base.salaries[0]!,annualGrossCents:26000000}],contributions:[{id:'saved-roth',accountId:'roth',priority:0,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:50000}}]});
 const r=resolved(syntheticCash(input,5000000),zeroTaxes);
 expect(r.report.accounts.find(a=>a.accountId==='roth')).toMatchObject({targetCents:750000,existingCents:600000,percentageCents:150000,actualCents:750000});
 expect(r.report.retainedCashCents).toBe(1800000);
 expect(r.requests.filter(q=>q.ruleId==='saved-roth')).toEqual(input.legacyRequests);
});

it('funds traditional catch-up at a second employer after protected regular deferrals',()=>{
 const base=makeAllocationPlan(),second={...base.accounts[2]!,id:'workplace-second'};
 const employerFacts=(employerId:string,priorYearWagesCents:number)=>({year:2026,employerId,priorYearWagesCents:{known:true as const,value:priorYearWagesCents},planCatchUpAvailable:{known:true as const,value:true},rothCatchUpAvailable:{known:true as const,value:true}});
 const entries:readonly CashFlowAllocationEntry[]=[maximum('workplace',1),{id:'entry-second',priority:2,destination:{kind:'account',accountId:'workplace-second',sponsoringSalaryId:'salary-second'},amount:{kind:'max-annual'}}];
 const input=fixture(entries,'cash',{
  accounts:[...base.accounts,second],
  salaries:[{...base.salaries[0]!,annualGrossCents:6000000},{...base.salaries[0]!,id:'salary-second',employerId:'employer-second',annualGrossCents:6000000}],
  household:{...base.household,filers:[{...base.household.filers[0],birthDate:{known:true,value:'1970-01-01'},workplaceCoverage:{known:true,value:true},employerAssumptionsByYear:[employerFacts('employer-0',20000000),employerFacts('employer-second',0)]},base.household.filers[1]]},
 });
 const opening=structuredClone(input.opening),r=resolved(input);
 expect(r.report.accounts.find(a=>a.accountId==='workplace')).toMatchObject({targetCents:2450000,maximumCents:2450000,actualCents:2450000,shortfallCents:0});
 expect(r.report.accounts.find(a=>a.accountId==='workplace-second')).toMatchObject({targetCents:800000,maximumCents:800000,actualCents:800000,shortfallCents:0});
 expect(r.household.contributions.every(c=>c.eligibleCents.status==='available'&&c.eligibleCents.value===c.requestedCents)).toBe(true);
 // AGI $87,500: federal taxable midpoint $55,325 => $2,480 + .12*$30,525 = $6,143.
 // CA taxable $75,700: round($229.12 + $628.04 + .04*$21,386) - $316 = $1,397.
 expect(sum(r.incomeTaxByMonth)).toBe(754000);
 expect(r.household.payroll.annual.totalCents).toBe(1074000);
 expect(r.report).toMatchObject({status:'funded',originalCashFlowCents:10172000,retainedCashCents:6922000});
 let cash=0;
 for(let month=1;month<=12;month++){
  const deposits=r.requests.filter(q=>q.month===month);
  cash+=r.preTransferCashByMonth[month-1]!-sum(deposits.map(q=>q.requestedCents));
  expect(cash).toBeGreaterThanOrEqual(0);
  for(const employer of ['employer-0','employer-second'])expect(sum(deposits.filter(q=>q.employerId===employer).map(q=>q.requestedCents))).toBeLessThanOrEqual(500000);
 }
 expect(cash).toBe(6922000);expect(input.opening).toEqual(opening);
});

it('isolates repeated solves when the opening IRA basis changes',()=>{
 const base=makeAllocationPlan(),input=fixture([maximum('ira')],'cash',{salaries:[{...base.salaries[0]!,annualGrossCents:20000000}]});
 const opening=structuredClone(input.opening),changed={...input,opening:{...input.opening,iraBasisByOwner:{...input.opening.iraBasisByOwner,'owner-a':{known:true as const,value:12345}}}};
 expect(resolved(input).household.closingTaxState.iraBasisByOwner['owner-a']).toEqual({known:true,value:750000});
 expect(resolved(changed).household.closingTaxState.iraBasisByOwner['owner-a']).toEqual({known:true,value:762345});
 expect(resolved(input).household.closingTaxState.iraBasisByOwner['owner-a']).toEqual({known:true,value:750000});
 expect(input.opening).toEqual(opening);expect(changed.opening.iraBasisByOwner['owner-a']).toEqual({known:true,value:12345});
});

it('isolates repeated solves when sponsoring employer catch-up history changes',()=>{
 const base=makeAllocationPlan();
 const inputFor=(wages:number)=>fixture([maximum('workplace')],'cash',{household:{...base.household,filers:[{...base.household.filers[0],birthDate:{known:true,value:'1970-01-01'},workplaceCoverage:{known:true,value:true},employerAssumptionsByYear:[{year:2026,employerId:'employer-0',priorYearWagesCents:{known:true,value:wages},planCatchUpAvailable:{known:true,value:true},rothCatchUpAvailable:{known:true,value:true}}]},base.household.filers[1]]}});
 const low=inputFor(0),high=inputFor(20000000),before=structuredClone(low.plan);
 expect(resolved(low).report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(3250000);
 expect(resolved(high).report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(2450000);
 expect(resolved(low).report.accounts.find(a=>a.accountId==='workplace')?.actualCents).toBe(3250000);
 expect(low.plan).toEqual(before);
});
