import type {Cents} from '../model/plan';
import type {Available,Issue,RuleProvenance} from '../model/results';
import {Decimal,settleCents} from '../money';
import {resolveHouseholdYear,type HouseholdYear} from '../tax/comparison';
import {resolveAllocationYear,type AllocationYearInput,type ResolvedAllocationYear} from './cash-flow-allocation';
import {allocateAnnualTax} from './tax-timing';
import {solveBrokerageFunding,type BrokerageFundingAccount,type BrokerageFundingEvent,type BrokerageFundingResult,type BrokerageSale} from './brokerage-funding';

const available=<T>(value:T):Available<T>=>({status:'available',value});
const total=(values:readonly number[])=>settleCents(values.reduce((sum,value)=>sum.plus(value),new Decimal(0)));
const monthly=(sales:readonly BrokerageSale[],amount:(sale:BrokerageSale)=>number)=>Array.from({length:12},(_,i)=>total(sales.filter(s=>Number(s.date.slice(5,7))===i+1).map(amount)));
const signedAllocation=(amount:number,weights:readonly number[])=>allocateAnnualTax(Math.abs(amount),weights).map(value=>amount<0?-value:value);
export interface BrokerageHousehold {
 readonly household:HouseholdYear;
 readonly allocation?:ResolvedAllocationYear;
 readonly federalByMonth:readonly Cents[];
 readonly californiaByMonth:readonly Cents[];
}
type Input=AllocationYearInput&Readonly<{year:number;accounts:readonly BrokerageFundingAccount[];events:readonly BrokerageFundingEvent[]}>;

/** Trial taxes retain the same construction/cash footprint; gains alone change the tax facts. */
export function resolveAduBrokerageYear(input:Input):Available<BrokerageFundingResult<BrokerageHousehold>>{
 const needed=Array.from({length:12},(_,i)=>total(input.events.filter(e=>Number(e.date.slice(5,7))===i+1).map(e=>e.constructionCents)));
 const policy=input.plan.cashFlowAllocation;
 const automaticAccounts=new Set(policy?[...policy.entries,policy.overflow].flatMap(source=>source.destination.kind==='account'?[source.destination.accountId]:[]):[]);
 const depositStartMonths=new Map<string,number>();
 for(const event of input.events){
  if(event.constructionCents<=0||!automaticAccounts.has(event.accountId))continue;
  const month=Number(event.date.slice(5,7));
  if(month>1)depositStartMonths.set(event.accountId,Math.max(depositStartMonths.get(event.accountId)??1,month));
 }
 const solve=(automaticDepositStartMonthsByAccount?:ReadonlyMap<string,number>)=>solveBrokerageFunding<BrokerageHousehold>({year:input.year,accounts:input.accounts,events:input.events,
  maxScheduleIterations:depositStartMonths.size&&!automaticDepositStartMonthsByAccount?8:64,evaluate(sales){
  const gross=monthly(sales,s=>s.grossSaleCents),oldFederal=monthly(sales,s=>s.federalTaxCents),oldCalifornia=monthly(sales,s=>s.californiaTaxCents);
  const gainWeights=monthly(sales,s=>Math.max(0,s.realizedGainCents));
  const weights=gainWeights.some(value=>value>0)?gainWeights:gross;
  function schedule(household:HouseholdYear,baseline?:BrokerageHousehold){
   if(household.tax.status!=='available')throw new Error('Brokerage tax schedule requires available household tax.');
   const tax=household.tax.value;
   if(!baseline)return {federalByMonth:allocateAnnualTax(tax.federal.totalCents,input.taxWeightsByMonth),californiaByMonth:allocateAnnualTax(tax.california.totalCents,input.taxWeightsByMonth)};
   const base=baseline.household.tax;if(base.status!=='available')throw new Error('Brokerage baseline requires available tax.');
   const federalRemainder=signedAllocation(total([tax.federal.totalCents,-base.value.federal.totalCents,-total(oldFederal)]),weights);
   const californiaRemainder=signedAllocation(total([tax.california.totalCents,-base.value.california.totalCents,-total(oldCalifornia)]),weights);
   return {federalByMonth:baseline.federalByMonth.map((v,i)=>total([v,oldFederal[i]!,federalRemainder[i]!])),californiaByMonth:baseline.californiaByMonth.map((v,i)=>total([v,oldCalifornia[i]!,californiaRemainder[i]!]))};
  }
  function run(gains:number,baseline?:BrokerageHousehold):Available<BrokerageHousehold>{
   const cash={...input.cash,longTermCapitalGainCents:gains};
   let allocation:ResolvedAllocationYear|undefined,household:HouseholdYear;
   if(input.plan.cashFlowAllocation){
    const result=resolveAllocationYear({...input,cash,...(automaticDepositStartMonthsByAccount?{automaticDepositStartMonthsByAccount}:{}),
     incomeTaxByMonth(h){const s=schedule(h,baseline);return s.federalByMonth.map((v,i)=>total([v,s.californiaByMonth[i]!]));},
     brokerageFundingByMonth(_h,taxes){return gross.map((v,i)=>Math.min(v,total([needed[i]!,...(baseline?[taxes[i]!,-baseline.federalByMonth[i]!,-baseline.californiaByMonth[i]!]:[])])));},
    });
    if(result.status!=='available')return result;
    allocation=result.value;household=result.value.household;
   }else household=resolveHouseholdYear(input.plan,cash,input.legacyRequests,input.property,input.loans,input.opening,input.rules);
   const missing=[household.tax,...household.contributions.map(r=>r.eligibleCents)].filter(v=>v.status!=='available');
   if(missing.length)return{status:missing.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:[...new Map(missing.flatMap(v=>v.issues).map(i=>[JSON.stringify(i),i])).values()]};
   return available({household,...(allocation?{allocation}:{}),...schedule(household,baseline)});
  }
  const baseline=run(0);if(baseline.status!=='available')return baseline;
  let payload=baseline.value,gains=0;
  const taxes:{eventId:string;federalTaxCents:number;californiaTaxCents:number}[]=[];
  for(const sale of sales){
   gains=total([gains,Math.max(0,sale.realizedGainCents)]);
   const next=run(gains,baseline.value);if(next.status!=='available')return next;
   const previousTax=payload.household.tax,nextTax=next.value.household.tax;
   if(previousTax.status!=='available'||nextTax.status!=='available')throw new Error('Resolved brokerage household lost tax availability.');
   taxes.push({eventId:sale.id,federalTaxCents:total([nextTax.value.federal.totalCents,-previousTax.value.federal.totalCents]),californiaTaxCents:total([nextTax.value.california.totalCents,-previousTax.value.california.totalCents])});
   payload=next.value;
  }
  const contributions=payload.household.contributions.map(r=>({accountId:r.accountId,month:r.month,amountCents:r.eligibleCents.status==='available'?r.eligibleCents.value:0}));
  return available({payload,contributions,taxes});
 }});
 const ordinary=solve();
 if(!depositStartMonths.size||ordinary.status==='available'||!ordinary.issues.some(issue=>issue.code==='brokerage-funding-cycle'||issue.code==='brokerage-funding-nonconvergence'))return ordinary;
 // Retry from the same opening ledger, keeping automatic deposits as cash until
 // the selected account's final sale has executed before month-end deposits.
 const fallback=solve(depositStartMonths);
 if(fallback.status!=='available')return fallback;
 const affectedProjects=[...new Set(input.events.filter(event=>event.constructionCents>0&&depositStartMonths.has(event.accountId)).map(event=>event.projectId))];
 const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
 const issues=affectedProjects.map(projectId=>{
  const event=input.events.find(event=>event.projectId===projectId&&depositStartMonths.has(event.accountId))!;
  const account=input.plan.accounts.find(account=>account.id===event.accountId)!;
  const month=depositStartMonths.get(event.accountId)!;
  return{...brokerageFundingIssue('brokerage-funding-deposit-timing',projectId,input.year,`Automatic deposits to ${account.name} resume at the end of ${monthNames[month-1]} ${input.year}. Earlier savings stay in household cash for construction costs that investment sales cannot cover. Saved contribution dates remain unchanged.`),resolution:'Review construction funding, sale timing or investment allocations if you want a different automatic-deposit schedule.'};
 });
 const payload=fallback.value.evaluation.payload;
 const household:HouseholdYear={...payload.household,issues:[...payload.household.issues,...issues],coverage:{...payload.household.coverage,completeHouseholdLiability:false,issues:[...payload.household.coverage.issues,...issues]}};
 return available({...fallback.value,evaluation:{...fallback.value.evaluation,payload:{...payload,household,...(payload.allocation?{allocation:{...payload.allocation,household}}:{})}}});
}

export function brokerageFundingProvenance(year:number):RuleProvenance {
 return{status:'provisional',ruleVersion:'adu-brokerage-funding.2',baselineYear:2026,applicableYear:year,
  sources:['https://www.irs.gov/publications/p550','https://www.irs.gov/instructions/i6251','https://www.irs.gov/taxtopics/tc559','https://www.ftb.ca.gov/file/personal/income-types/capital-gains-and-losses.html'],
  assumptions:['Construction sales use proportional total account basis and assume long-term holdings, including any recent deposits; actual tax lots and holding periods can differ.','Unknown opening brokerage basis uses a labeled zero-basis planning assumption without changing the saved answer.','Generated sale losses are reported but receive no deduction, offset or carryforward benefit; taxable generated gains sum positive event gains only.','Gross sale proceeds are transfers, not earned income. Only gains enter tax facts; actual household federal, California, AMT, NIIT and modeled deduction interactions determine incremental tax.','Construction and its incremental tax are funded by the sale; tax is reserved in the sale month, independently of actual brokerage withholding or estimated-tax payment dates.','Sales cannot exceed available account value before month-end contributions. Account shortfalls remain explicit conditional funding gaps.','When a labeled timing fallback is needed, automatic deposits into the construction-funding account stay as household cash until its final construction-sale month, then enter at month end. Saved contribution dates remain unchanged; only actual sale proceeds offset construction and tax.']};
}

export function brokerageFundingIssue(code:string,recordId:string,year:number,explanation:string):Issue {
 return{code,recordId,year,field:code==='estimated-brokerage-basis'?'openingTaxableBasis':'ownerFunding',severity:code==='brokerage-funding-shortfall'?'warning':'info',explanation,resolution:code==='estimated-brokerage-basis'?'Enter the investment cost basis on the selected account.':'Review construction funding and the selected account.'};
}
