import type { Cents, Debt, PlanDocument, PropertyLoan, ValidatedPlan } from './model/plan';
import type { Available, Coverage, Issue, RuleProvenance } from './model/results';
import { initialTaxState, type HouseholdTaxState } from './model/tax-state';
import { CalculationRangeError, Decimal, settleCents } from './money';
import { resolveCashYear, type CashStream, type CashYear } from './cash/income';
import { projectRsuAccounts, type RsuGrantMonth, type RsuProjection } from './equity/rsu';
import { addRsuWages } from './tax/rsu-income';
import { requestContributions, type ContributionRequest } from './cash/contribution-requests';
import { resolveAllocationYear, type ResolvedAllocationYear } from './cash/cash-flow-allocation';
import { backdoorRothProvenance } from './cash/backdoor-roth';
import { childPlanningProvenance } from './rules/child-planning-v1';
import { calculateLoanSchedule, type LoanSchedule, type OpeningLoanProvenance } from './property/loans';
import {resolveAduYear} from './property/adu-lifecycle';
import {getAduProjects} from './property/adu-ownership';
import type {AduLoanMonth} from './property/adu-loans';
import {prepareAduTaxYear,finishAduTaxYear} from './property/adu-tax';
import {cashFlowBeforeInvestments,projectAduMonth,combineAduMonth} from './property/adu-projection';
import {aduPlanningProvenance} from './rules/adu-planning-v1';
import {resolveAduPlanningEstimates,aduEstimateProvenance} from './property/adu-planning-estimates';
import {resolvePurchasePlanningEstimates,purchaseEstimateProvenance} from './property/purchase-planning-estimates';
import { buildPropertyFacts } from './property/facts';
import { growMonth, propertyRate } from './growth';
import { validatePlan } from './validation';
import { resolveYearRules } from './rules/projection';
import type { RuleSet } from './rules/types';
import { resolveHouseholdYear, type HouseholdYear } from './tax/comparison';
import { resolveWorkplaceContributions } from './tax/workplace';
import { calculatePayroll, type PayrollYear } from './tax/payroll';
import type { ContributionRecord } from './tax/facts';
import { checkCoverage, rsuDeferredTaxIssues } from './coverage';
import { calendarDate, parseISODate } from './dates';
import { summarizeProjectionYear } from './reporting';
import type { AccountProjection, LoanProjection, MonthlyProjection, ProjectionResult, PropertyProjection, RsuPeriod } from './projection-types';
export type * from './projection-types';

import { allocateAnnualTax } from './cash/tax-timing';
import {resolveAduBrokerageYear,brokerageFundingIssue,brokerageFundingProvenance,type BrokerageHousehold} from './cash/adu-brokerage-year';
import type {BrokerageFundingEvent,BrokerageFundingResult} from './cash/brokerage-funding';
export { allocateAnnualTax } from './cash/tax-timing';

const available=<T>(value:T):Available<T>=>({status:'available',value});
function combine<T>(values:readonly Available<unknown>[],calculate:()=>T):Available<T> {
  const missing=values.filter(v=>v.status!=='available');
  // Carried balances revisit the same dependencies in every month and year.
  return missing.length?{status:missing.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:uniqueIssues(missing.flatMap(v=>v.issues))}:available(calculate());
}
const numeric=(value:Available<Cents>):Cents=>{if(value.status!=='available')throw new Error('Unavailable value used in a calculation.');return value.value;};
const uniqueIssues=(issues:readonly Issue[]):readonly Issue[]=>[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()];
const uniqueProvenance=(values:readonly RuleProvenance[]):readonly RuleProvenance[]=>[...new Map(values.map(p=>[JSON.stringify(p),p])).values()];

function withoutAllocation(plan:ValidatedPlan):PlanDocument {
  const {cashFlowAllocation:_,...document}=plan;return document;
}

/** Recovery selects runtime streams before arithmetic, preserving the valid ownership graph. */
function taxStreamIds(plan:ValidatedPlan):ReadonlySet<string>{
  return new Set([...plan.salaries.map(s=>s.id),...plan.otherIncome.map(s=>s.id),...plan.rentals.map(r=>r.id),...plan.expenses.filter(e=>e.propertyId||e.rentalId).map(e=>e.id),...getAduProjects(plan).flatMap(({project})=>[...project.costs.map(c=>c.id),...project.propertyTax.paymentYears.flatMap(y=>y.payments.map(p=>p.id))])]);
}
function wageStreamIds(plan:ValidatedPlan):ReadonlySet<string>{return new Set([...plan.salaries.map(s=>s.id),...plan.otherIncome.filter(o=>o.classification==='wage').map(o=>o.id)]);}

function interruptedTaxState(opening:HouseholdTaxState,year:number,reason:Available<never>):HouseholdTaxState {
  const preserveCredit=(jurisdiction:'federal'|'california')=>{const h=opening.minimumTaxCreditCoverage[jurisdiction];return h.known&&h.value?h:{known:false} as const;};
  return {...opening,year,rentals:Object.fromEntries(Object.entries(opening.rentals).map(([id,books])=>[id,Object.fromEntries(Object.keys(books).map(book=>[book,reason])) as HouseholdTaxState['rentals'][string]])),qbiLossVintages:Object.fromEntries(Object.keys(opening.qbiLossVintages).map(id=>[id,{known:false}])),iraBasisByOwner:Object.fromEntries(Object.keys(opening.iraBasisByOwner).map(id=>[id,{known:false}])),minimumTaxCreditCoverage:{federal:preserveCredit('federal'),california:preserveCredit('california')}};
}

/** Pure monthly scenario. Eligibility precedes deposits; residual cash remains a signed reserve. */
export function calculateProjection(inputs:ValidatedPlan,ruleSet:RuleSet):ProjectionResult {
  const plan=resolveAduPlanningEstimates(resolvePurchasePlanningEstimates(inputs));
  const estimates=plan.properties.some(property=>property.aduProject?.taxEstimation?.mode==='simple');
  const months:MonthlyProjection[]=[],years:ProjectionResult['years'][number][]=[],contributions:ContributionRecord[]=[],contributionSchedules:ProjectionResult['contributionSchedules'][number][]=[],taxStates:ProjectionResult['taxStates'][number][]=[],loanSchedules:ProjectionResult['loanSchedules'][number][]=[],cashSchedules:ProjectionResult['cashSchedules'][number][]=[],allIssues:Issue[]=[],allProvenance:RuleProvenance[]=[];
  const range=<T>(recordId:string,year:number,field:string,calculate:()=>T):Available<T>=>{
    try{return available(calculate());}catch(error){
      if(!(error instanceof CalculationRangeError))throw error;
      const issue:Issue={code:'monetary-overflow',recordId,year,field,severity:'error',explanation:'This calculation exceeds the supported monetary range; dependent amounts are unavailable.',resolution:'Reduce the amount, rate or horizon; inspect the independent records that remain available.'};
      allIssues.push(issue);return {status:'unsupported-case',issues:[issue]};
    }
  };
  const sum=(values:readonly Available<Cents>[],year:number,field:string,recordId=plan.id):Available<Cents>=>{
    const result=combine(values,()=>0);if(result.status!=='available')return result;
    return range(recordId,year,field,()=>settleCents(values.reduce((s,v)=>s.plus(numeric(v)),new Decimal(0))));
  };
  const rsuAccounts=plan.accounts.filter(a=>a.type==='rsu');
  const rsuSchedules:NonNullable<ProjectionResult['rsuSchedules']>[number][]=[];
  const completeRsuSchedules=new Map<string,RsuProjection>();
  for(const account of rsuAccounts) {
    try{completeRsuSchedules.set(account.id,projectRsuAccounts({...plan,accounts:[account]}));}
    catch(error){if(!(error instanceof CalculationRangeError))throw error;}
    // A later overflow uses year prefixes below so earlier valid years stay available.
  }
  const accountExact=new Map<string,Available<Decimal>>(plan.accounts.map(a=>[a.id,available(new Decimal(a.openingBalanceCents))]));
  const purchases=plan.properties.filter(p=>p.purchaseDate>`${plan.startYear}-01-01`),purchaseIds=new Set(purchases.map(p=>p.id));
  const existingHomeExact=new Map<string,Available<Decimal>>(plan.properties.map(p=>[p.id,available(new Decimal(purchaseIds.has(p.id)?0:p.openingValueCents))]));
  const priorMarketComplete=new Map(plan.properties.map(p=>[p.id,true]));
  const projects=getAduProjects(plan);
  const fundedAccountIds=new Set([...projects.flatMap(({project})=>project.ownerFunding?.kind==='taxable-brokerage'?[project.ownerFunding.accountId]:[]),...purchases.flatMap(property=>property.purchaseFunding?.kind==='taxable-brokerage'?[property.purchaseFunding.accountId]:[])]);
  const brokerageBasis=new Map<string,Available<Cents>>(plan.accounts.filter(a=>fundedAccountIds.has(a.id)).map(a=>[a.id,available(a.openingTaxableBasis?.known?a.openingTaxableBasis.value:0)]));
  const propertyExact=new Map<string,Available<Decimal>>(plan.properties.map(p=>[p.id,available(new Decimal(purchaseIds.has(p.id)?0:p.openingValueCents))]));
  const declaredLoans=[...plan.properties.flatMap(p=>p.loans.map(loan=>({kind:'original' as const,loan,propertyId:p.id}))),...plan.debts.map(loan=>({kind:'original' as const,loan,...(loan.propertyId?{propertyId:loan.propertyId}:{})})),...projects.flatMap(({project,property})=>project.financing?[{kind:'adu-project' as const,loan:project.financing,propertyId:property.id,projectId:project.id}]:[])].sort((a,b)=>a.loan.id.localeCompare(b.loan.id));
  const loanClosing=new Map<string,Available<Cents>>(),loanOrigin=new Map<string,{opening:OpeningLoanProvenance;payment:OpeningLoanProvenance}>();
  const openingTaxState=initialTaxState(plan);let taxState=openingTaxState,reserve:Available<Cents>=available(plan.openingCashCents),conditionalOnGap=false;let lastEarmarked:Available<Cents>=available(0);
  const streamDefinitions=[...plan.salaries.map(s=>({id:s.id,kind:'salary' as const})),...plan.otherIncome.map(s=>({id:s.id,kind:'other-income' as const})),...plan.expenses.map(s=>({id:s.id,kind:'expense' as const,...(s.propertyId?{propertyId:s.propertyId}:{})})),...(plan.children??[]).map(child=>({id:child.id,kind:'expense' as const})),...purchases.map(property=>({id:property.id,kind:'expense' as const,propertyId:property.id})),...plan.rentals.map(s=>({id:s.id,kind:'rent' as const})),...projects.flatMap(({project,property})=>[...project.costs.map(c=>({id:c.id,kind:'expense' as const,propertyId:property.id})),...project.propertyTax.paymentYears.flatMap(y=>y.payments.map(p=>({id:p.id,kind:'expense' as const,propertyId:property.id})))])].sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  for(let year=plan.startYear;year<plan.startYear+plan.horizonYears;year++) {
    const issueStart=allIssues.length,opening=taxState;
    const aduContext=resolveAduYear(plan,year);
    const brokerageEvents:BrokerageFundingEvent[]=[...projects.flatMap(({project,property})=>{
      if(project.ownerFunding?.kind!=='taxable-brokerage')return[];
      const accountId=project.ownerFunding.accountId;
      return project.costs.filter(cost=>cost.paymentDate.startsWith(`${year}-`)).map(cost=>{
        const financed=settleCents((project.financing?.draws??[]).filter(draw=>draw.month<=cost.paymentDate.slice(0,7)).flatMap(draw=>draw.costAllocations.filter(a=>a.costId===cost.id)).reduce((n,a)=>n.plus(a.amountCents),new Decimal(0)));
        return{id:cost.id,projectId:project.id,propertyId:property.id,accountId,date:cost.paymentDate,constructionCents:Math.max(0,cost.amountCents-financed)};
      }).filter(e=>e.constructionCents>0);
    }),...purchases.flatMap(property=>property.purchaseFunding?.kind==='taxable-brokerage'&&property.purchaseDate.startsWith(`${year}-`)&&property.downPaymentCents>0?[{id:property.id,projectId:property.id,propertyId:property.id,accountId:property.purchaseFunding.accountId,date:property.purchaseDate,constructionCents:property.downPaymentCents,purpose:'property-down-payment' as const}]:[])];
    let brokerage:Available<BrokerageFundingResult<BrokerageHousehold>>|undefined;
    for(const account of plan.accounts.filter(a=>fundedAccountIds.has(a.id)&&!a.openingTaxableBasis?.known))allIssues.push(brokerageFundingIssue('estimated-brokerage-basis',account.id,year,'Investment cost basis is unknown. This funding estimate assumes zero opening basis; saved history remains unknown.'));
    const openingUnrestricted=sum([reserve,lastEarmarked.status==='available'?available(-lastEarmarked.value):lastEarmarked],year,'openingUnrestrictedCashCents');
    const rsuByAccount=new Map<string,Available<readonly RsuGrantMonth[]>>();
    for(const account of rsuAccounts) {
      const projected=range(account.id,year,'rsu',()=>completeRsuSchedules.get(account.id)??projectRsuAccounts({...plan,accounts:[account],horizonYears:year-plan.startYear+1}));
      const schedule=projected.status==='available'?available(projected.value.months.filter(m=>m.year===year)):projected;
      if(projected.status==='available')allIssues.push(...projected.value.issues.filter(issue=>issue.year===undefined||issue.year===year));
      rsuByAccount.set(account.id,schedule);rsuSchedules.push({accountId:account.id,year,schedule});
    }
    const rsuYear:Available<readonly RsuGrantMonth[]>=combine([...rsuByAccount.values()],()=>[...rsuByAccount.values()].flatMap(s=>s.status==='available'?[...s.value]:[]));
    const cash=range(plan.id,year,'cash',()=>resolveCashYear(plan,year));
    const streams=new Map<string,Available<CashStream>>();
    for(const definition of streamDefinitions){
      const stream=cash.status==='available'?available(cash.value.streams.find(s=>s.id===definition.id)!):range(definition.id,year,'cashStream',()=>resolveCashYear(plan,year,{streamIds:new Set([definition.id])}).streams.find(s=>s.id===definition.id)!);
      streams.set(definition.id,stream);cashSchedules.push({recordId:definition.id,year,kind:definition.kind,schedule:stream});
    }
    const yearLoans:Available<LoanSchedule>[]=[];
    for(const descriptor of declaredLoans){
      if(descriptor.kind==='adu-project'){
        const resolved=aduContext.projects.find(p=>p.projectId===descriptor.projectId)!.loan!;
        const schedule=resolved.status==='available'?available({...resolved.value,startYear:year,horizonYears:1,months:resolved.value.months.filter(m=>m.date.startsWith(`${year}-`))}):resolved;
        yearLoans.push(schedule);loanSchedules.push({loanId:descriptor.loan.id,year,schedule});continue;
      }
      const {loan}=descriptor;
      const plannedOrigination=descriptor.propertyId!==undefined&&purchaseIds.has(descriptor.propertyId)&&'originationDate' in loan;
      const previous=plannedOrigination&&year<=Number(loan.originationDate.slice(0,4))?undefined:loanClosing.get(loan.id);let schedule:Available<LoanSchedule>;
      if(previous&&previous.status!=='available')schedule=previous;
      else {
        const continued:Debt|PropertyLoan=previous?.status==='available'?'originalPrincipalCents' in loan?{...loan,openingBalance:{known:true,value:previous.value}}:{...loan,openingBalanceCents:previous.value}:loan;
        schedule=range(loan.id,year,'loanSchedule',()=>calculateLoanSchedule(continued,year,1,plannedOrigination?{plannedOrigination:true}:undefined));
        if(schedule.status==='available'){
          const origin=loanOrigin.get(loan.id)??{opening:schedule.value.openingProvenance,payment:schedule.value.paymentProvenance};loanOrigin.set(loan.id,origin);
          const estimateIssues=origin.opening==='estimated'?[{code:'estimated-opening-loan-balance',recordId:loan.id,year,field:'openingBalance',severity:'info' as const,explanation:'This carried balance originated from an estimated scheduled opening balance.',resolution:'Supply the original January opening balance to replace the estimate.'}]:[];
          schedule=available({...schedule.value,openingProvenance:origin.opening,paymentProvenance:origin.payment,months:schedule.value.months.map(m=>({...m,openingProvenance:origin.opening})),issues:uniqueIssues([...schedule.value.issues,...estimateIssues])});
        }
      }
      yearLoans.push(schedule);loanSchedules.push({loanId:loan.id,year,schedule});loanClosing.set(loan.id,schedule.status==='available'?available(schedule.value.months[11]!.closingPrincipalCents):schedule);
      if(schedule.status==='available')allIssues.push(...schedule.value.issues);
    }
    const rules=resolveYearRules(ruleSet,year,plan.taxPolicy);
    if(rules.status==='available')allProvenance.push(...Object.values(rules.value.provenance));else allIssues.push(...rules.issues);
    const cashForTax=cash.status==='available'?cash:range(plan.id,year,'taxCash',()=>resolveCashYear(plan,year,{streamIds:taxStreamIds(plan)}));
    const taxCash:Available<CashYear>=cashForTax.status==='available'&&rsuYear.status==='available'?range(plan.id,year,'rsuTaxWages',()=>addRsuWages(cashForTax.value,rsuAccounts,rsuYear.value)):combine([cashForTax,rsuYear],()=>undefined as never);
    const requestResults=new Map<string,Available<readonly ContributionRequest[]>>();
    for(const rule of [...plan.contributions].sort((a,b)=>a.id.localeCompare(b.id))){
      const account=plan.accounts.find(a=>a.id===rule.accountId)!,sponsor=plan.salaries.find(s=>s.id===rule.sponsoringSalaryId);
      let result:Available<readonly ContributionRequest[]>;
      if(rule.amount.kind==='fixed'){
        const amount=rule.amount.monthlyCents;
        result=available(Array.from({length:12},(_,i)=>{const date=calendarDate(year,i+1,31);return {ruleId:rule.id,accountId:account.id,ownerId:account.ownerId,year,month:i+1,priority:rule.priority,requestedCents:date>=rule.startDate&&(!rule.endDate||date<=rule.endDate)?amount:0,...(rule.sponsoringSalaryId?{sponsoringSalaryId:rule.sponsoringSalaryId}:{}),...(sponsor?{employerId:sponsor.employerId}:{})};}));
      }else {
        const salaryId=rule.amount.salaryId;
        result=range(rule.id,year,'contributionRequests',()=>{
          const subset=validatePlan({...withoutAllocation(plan),contributions:[rule]});if(!subset.ok)throw new Error('Contribution recovery produced an invalid derived scenario.');
          const source=taxCash.status==='available'?taxCash.value:resolveCashYear(plan,year,{streamIds:new Set([salaryId])});
          return requestContributions(subset.plan,source);
        });
      }
      requestResults.set(rule.id,result);contributionSchedules.push({ruleId:rule.id,year,requests:result});
    }
    let knownRequests:readonly ContributionRequest[]=[...requestResults.values()].flatMap(r=>r.status==='available'?[...r.value]:[]).sort((a,b)=>a.month-b.month||a.priority-b.priority||a.ruleId.localeCompare(b.ruleId));
    const retirementRequestResults=plan.contributions.filter(r=>plan.accounts.find(a=>a.id===r.accountId)!.type!=='taxable-brokerage').map(r=>requestResults.get(r.id)!);
    const taxLoans=yearLoans.filter((_,index)=>declaredLoans[index]!.kind==='original'&&declaredLoans[index]!.propertyId);
    let household:Available<HouseholdYear>=combine([taxCash,rules,...retirementRequestResults,...taxLoans],()=>undefined as never);
    let allocation:Available<ResolvedAllocationYear>|undefined;
    const allocationSources=plan.cashFlowAllocation?[...plan.cashFlowAllocation.entries,plan.cashFlowAllocation.overflow].filter(source=>source.destination.kind==='account'):[];
    if(brokerageEvents.length){
      const tracked=plan.accounts.filter(a=>fundedAccountIds.has(a.id));
      brokerage=combine([cash,taxCash,rules,rsuYear,...requestResults.values(),...yearLoans,aduContext.cashComplete,openingUnrestricted,...tracked.flatMap(a=>[accountExact.get(a.id)!,brokerageBasis.get(a.id)!])],()=>undefined as never);
      if(brokerage.status==='available'&&cash.status==='available'&&taxCash.status==='available'&&rules.status==='available'&&rsuYear.status==='available'){
        const attempted=range(plan.id,year,'ownerFunding',()=>{
          const loans=taxLoans.map(s=>{if(s.status!=='available')throw new Error('Unavailable tax loan');return s.value;});
          const total=(values:readonly number[])=>settleCents(values.reduce((n,v)=>n.plus(v),new Decimal(0)));
          return resolveAduBrokerageYear({plan,year,cash:taxCash.value,legacyRequests:knownRequests,property:buildPropertyFacts(plan,taxCash.value,loans,opening,rules.value,aduContext),loans,opening,rules:rules.value,
            accounts:tracked.map(a=>{const balance=accountExact.get(a.id)!,basis=brokerageBasis.get(a.id)!;if(balance.status!=='available'||basis.status!=='available')throw new Error('Unavailable brokerage opening ledger');return{accountId:a.id,annualGrowthBps:a.annualGrowthBps,openingExact:balance.value,openingBasisCents:basis.value};}),events:brokerageEvents,
            financedConstructionByMonth:Array.from({length:12},(_,i)=>total(aduContext.projects.map(p=>p.months[i]!.financedCostPaidCents))),openingUnrestrictedCashCents:openingUnrestricted,
            openingAccountBalances:new Map([...accountExact].map(([id,balance])=>[id,balance.status==='available'?available(settleCents(balance.value)):balance])),
            cashIncomeByMonth:cash.value.months.map(m=>m.grossIncomeCents),expensesByMonth:cash.value.months.map(m=>m.expensesCents),
            debtPaymentsByMonth:Array.from({length:12},(_,i)=>total(yearLoans.map(s=>{if(s.status!=='available')throw new Error('Unavailable loan');return s.value.months[i]!.paymentCents;}))),
            rsuWithholdingByMonth:Array.from({length:12},(_,i)=>total(rsuYear.value.filter(g=>g.month===i+1).map(g=>g.withholdingCents))),
            taxWeightsByMonth:taxCash.value.positiveGrossCashByMonth.map((v,i)=>total([v,...rsuYear.value.filter(g=>g.month===i+1).map(g=>g.taxableIncomeCents)])),
          });
        });
        brokerage=attempted.status==='available'?attempted.value:attempted;
      }
      household=brokerage.status==='available'?available(brokerage.value.evaluation.payload.household):brokerage;
      if(brokerage.status==='available'){
        const payload=brokerage.value.evaluation.payload;
        if(payload.allocation){allocation=available(payload.allocation);knownRequests=payload.allocation.requests;allIssues.push(...payload.allocation.report.reasons);}
        for(const sale of brokerage.value.sales)if(sale.shortfallCents>0)allIssues.push(brokerageFundingIssue('brokerage-funding-shortfall',sale.projectId,year,`The selected brokerage cannot cover this ${sale.purpose==='property-down-payment'?'down payment':'construction payment'} and its estimated sale tax. The remaining cost requires additional funding.`,sale.purpose));
      }else if(plan.cashFlowAllocation)allocation=brokerage;
      for(const source of allocationSources){const requests:Available<readonly ContributionRequest[]>=allocation?.status==='available'?available(allocation.value.requests.filter(r=>r.ruleId===source.id)):allocation??brokerage as Available<never>;requestResults.set(source.id,requests);contributionSchedules.push({ruleId:source.id,year,requests});}
    }
    if(plan.cashFlowAllocation&&!brokerageEvents.length){
      allocation=combine([cash,taxCash,rules,rsuYear,...requestResults.values(),...yearLoans,...(projects.length||purchases.length?[aduContext.cashComplete,openingUnrestricted]:[])],()=>undefined as never);
      if(allocation.status==='available'&&cash.status==='available'&&taxCash.status==='available'&&rules.status==='available'&&rsuYear.status==='available'){
        const attempted=range(plan.cashFlowAllocation.id,year,'cashFlowAllocation',()=>{
          const loans=taxLoans.map(s=>{if(s.status!=='available')throw new Error('Unavailable loan');return s.value;});
          const property=buildPropertyFacts(plan,taxCash.value,loans,opening,rules.value,aduContext);
          const total=(values:readonly Cents[])=>settleCents(values.reduce((sum,value)=>sum.plus(value),new Decimal(0)));
          return resolveAllocationYear({plan,cash:taxCash.value,legacyRequests:knownRequests,property,loans,opening,rules:rules.value,
            ...(projects.length||purchases.length?{financedConstructionByMonth:Array.from({length:12},(_,i)=>total(aduContext.projects.map(p=>p.months[i]!.financedCostPaidCents))),openingUnrestrictedCashCents:openingUnrestricted}:{}),
            openingAccountBalances:new Map([...accountExact].map(([id,balance])=>[id,balance.status==='available'?available(settleCents(balance.value)):balance])),
            cashIncomeByMonth:cash.value.months.map(m=>m.grossIncomeCents),expensesByMonth:cash.value.months.map(m=>m.expensesCents),
            debtPaymentsByMonth:Array.from({length:12},(_,i)=>total(yearLoans.map(s=>{if(s.status!=='available')throw new Error('Unavailable loan');return s.value.months[i]!.paymentCents;}))),
            rsuWithholdingByMonth:Array.from({length:12},(_,i)=>total(rsuYear.value.filter(g=>g.month===i+1).map(g=>g.withholdingCents))),
            taxWeightsByMonth:taxCash.value.positiveGrossCashByMonth.map((weight,i)=>total([weight,...rsuYear.value.filter(g=>g.month===i+1).map(g=>g.taxableIncomeCents)]))});
        });
        allocation=attempted.status==='available'?attempted.value:attempted;
      }
      // Only the verified requests and closing state reach actual account posting.
      household=allocation.status==='available'?available(allocation.value.household):allocation;
      if(allocation.status==='available'){knownRequests=allocation.value.requests;allIssues.push(...allocation.value.report.reasons);}
      for(const source of allocationSources){
        const requests:Available<readonly ContributionRequest[]>=allocation.status==='available'?available(allocation.value.requests.filter(request=>request.ruleId===source.id)):allocation;
        requestResults.set(source.id,requests);contributionSchedules.push({ruleId:source.id,year,requests});
      }
    }
    if(!plan.cashFlowAllocation&&!brokerageEvents.length&&household.status==='available'&&taxCash.status==='available'&&rules.status==='available'){
      household=range(plan.id,year,'householdYear',()=>{
        const loans=taxLoans.map(s=>{if(s.status!=='available')throw new Error('Unavailable loan');return s.value;});
        const property=buildPropertyFacts(plan,taxCash.value,loans,opening,rules.value,aduContext);
        return resolveHouseholdYear(plan,taxCash.value,knownRequests,property,loans,opening,rules.value);
      });
    }
    let records:readonly ContributionRecord[]=[],payroll:Available<PayrollYear>;
    if(household.status==='available'){
      records=household.value.contributions;payroll=available(household.value.payroll);taxState=household.value.closingTaxState;allIssues.push(...household.value.issues);
    }else {
      allIssues.push(...household.issues);taxState=interruptedTaxState(opening,year,household);
      if(projects.length&&rules.status==='available'){const prepared=prepareAduTaxYear(plan,aduContext,opening,rules.value);taxState=finishAduTaxYear(prepared,taxState);}
      const wageCash=taxCash.status==='available'?taxCash:rsuYear.status==='available'?range(plan.id,year,'wageCash',()=>addRsuWages(resolveCashYear(plan,year,{streamIds:wageStreamIds(plan)}),rsuAccounts,rsuYear.value)):rsuYear;
      const workplaceRequestResults=plan.contributions.filter(r=>{const type=plan.accounts.find(a=>a.id===r.accountId)!.type;return type==='traditional-401k'||type==='roth-401k';}).map(r=>requestResults.get(r.id)!);
      const workplace=wageCash.status==='available'&&rules.status==='available'&&workplaceRequestResults.every(r=>r.status==='available')?range(plan.id,year,'workplace',()=>resolveWorkplaceContributions(plan,wageCash.value,knownRequests,rules.value)):combine([wageCash,rules,...workplaceRequestResults],()=>undefined as never);
      payroll=wageCash.status==='available'&&rules.status==='available'?range(plan.id,year,'payroll',()=>calculatePayroll(wageCash.value,resolveWorkplaceContributions(plan,wageCash.value,[],rules.value),rules.value)):combine([wageCash,rules],()=>undefined as never);
      records=knownRequests.map(r=>{
        const known=workplace.status==='available'?workplace.value.records.find(c=>c.ruleId===r.ruleId&&c.month===r.month):undefined;if(known)return known;
        const account=plan.accounts.find(a=>a.id===r.accountId)!;
        const eligible:Available<Cents>=account.type==='taxable-brokerage'?available(r.requestedCents):r.requestedCents===0?available(0):household;
        return {ruleId:r.ruleId,accountId:r.accountId,ownerId:r.ownerId,year,month:r.month,requestedCents:r.requestedCents,eligibleCents:eligible,deductibleCents:account.type==='taxable-brokerage'?available(0):eligible,nondeductibleCents:eligible,preventedCents:eligible.status==='available'?available(r.requestedCents-eligible.value):eligible,reasons:eligible.status==='available'?[]:eligible.issues};
      });
    }
    const deferredIssues=rsuDeferredTaxIssues(plan,year);
    if(deferredIssues.length)payroll={status:'unsupported-case',issues:deferredIssues};
    contributions.push(...records);taxStates.push({year,opening,closing:taxState});
    const tax=household.status==='available'?household.value.tax:household;
    const incomeAllocation=(jurisdiction:'federal'|'california'):Available<readonly Cents[]>=>tax.status==='available'&&taxCash.status==='available'&&rsuYear.status==='available'?range(plan.id,year,`${jurisdiction}IncomeTaxCents`,()=>allocateAnnualTax(tax.value[jurisdiction].totalCents,taxCash.value.positiveGrossCashByMonth.map((cashWeight,i)=>settleCents(new Decimal(cashWeight).plus(rsuYear.value.filter(g=>g.month===i+1).reduce((s,g)=>s.plus(g.taxableIncomeCents),new Decimal(0))))))):combine([tax,taxCash,rsuYear],()=>undefined as never);
    const federal=brokerage?.status==='available'?available(brokerage.value.evaluation.payload.federalByMonth):incomeAllocation('federal'),california=brokerage?.status==='available'?available(brokerage.value.evaluation.payload.californiaByMonth):incomeAllocation('california');
    const carriedDistributionIssues:Issue[]=plan.household.filers.flatMap(filer=>{
      if(!filer.birthDate.known)return [];
      const birth=parseISODate(filer.birthDate.value).year,age=year-birth,distributionAge=birth>=1960?75:birth>=1951?73:72;
      const deferred=plan.accounts.some(a=>a.ownerId===filer.id&&(a.type==='traditional-ira'||a.type==='traditional-401k')&&accountExact.get(a.id)?.status==='available'&&(accountExact.get(a.id) as {status:'available';value:Decimal}).value.gt(0));
      return deferred&&age>=distributionAge?[{code:'omitted-distributions',recordId:filer.id,year,field:'birthDate',severity:'warning' as const,explanation:'A carried retirement balance reaches an age at which this contribution-and-growth scenario omits potentially required distributions.',resolution:'Treat household liability as incomplete and model retirement distributions separately.'}]:[];
    });
    allIssues.push(...carriedDistributionIssues);
    const baseCoverage=household.status==='available'?household.value.coverage:checkCoverage(plan,year);
    const coverage:Coverage={completeForModeledScope:baseCoverage.completeForModeledScope&&household.status==='available',completeHouseholdLiability:baseCoverage.completeHouseholdLiability&&household.status==='available'&&carriedDistributionIssues.length===0,issues:uniqueIssues([...baseCoverage.issues,...carriedDistributionIssues,...(household.status==='available'?[]:household.issues)])};
    const rsuProvenance:RuleProvenance[] = rsuAccounts.length?[{status:'projected',ruleVersion:'rsu-settle-at-vest.1',baselineYear:2026,applicableYear:year,sources:['https://www.irs.gov/pub/irs-pdf/p5992.pdf','https://www.irs.gov/publications/p15','https://www.irs.gov/publications/p15a','https://www.irs.gov/publications/p551','https://www.ftb.ca.gov/forms/misc/1004.html','https://edd.ca.gov/en/payroll_taxes/What_Are_Wages'],assumptions:['RSU shares are delivered at each vest; deferred settlement tax timing requires a separate model.','Current share price is assumed on January 1 of the forecast start year, compounds between any entered price targets, and uses the entered effective annual rate after the final target or throughout when no targets are entered.','Sell-to-cover uses the entered fractional-share percentage at the vest valuation with no capital gain or fee; its proceeds fund assessed tax reserves rather than establish a final tax rate.','Income-tax reserve timing is a planning allocation, not an actual payroll-remittance or refund schedule.']}]:[];
    const deductionProvenance=household.status==='available'?household.value.candidates.flatMap(candidate=>Object.values(candidate.deductions).flatMap(deduction=>deduction.status==='available'&&deduction.value.detail?[deduction.value.detail.provenance]:[])):[];
    const taxProvenance=tax.status==='available'?[tax.value.provenance]:[];
    const conversionProvenance=allocationSources.some(source=>source.destination.kind==='account'&&source.destination.backdoorRoth)?[backdoorRothProvenance(year)]:[];
    const childProvenance=plan.children?.length?[childPlanningProvenance(year)]:[];
    allProvenance.push(...rsuProvenance,...taxProvenance,...deductionProvenance,...conversionProvenance,...childProvenance,...(projects.length?aduPlanningProvenance(year):[]));
    const estimateProvenance=estimates?[aduEstimateProvenance(year)]:[];
    if(purchases.some(property=>property.purchaseTaxEstimation?.mode==='simple'))estimateProvenance.push(purchaseEstimateProvenance(year));
    if(fundedAccountIds.size)estimateProvenance.push(brokerageFundingProvenance(year));
    allProvenance.push(...estimateProvenance);
    const provenance=uniqueProvenance([...(rules.status==='available'?Object.values(rules.value.provenance):[]),...rsuProvenance,...taxProvenance,...deductionProvenance,...conversionProvenance,...childProvenance,...(projects.length?aduPlanningProvenance(year):[]),...estimateProvenance]);
    const yearMonths:MonthlyProjection[]=[];
    for(let month=1;month<=12;month++){
      const fieldIssuesStart=allIssues.length,i=month-1;
      const streamSum=(predicate:(definition:typeof streamDefinitions[number])=>boolean,field:string):Available<Cents>=>sum(streamDefinitions.filter(predicate).map(d=>{const s=streams.get(d.id)!;return s.status==='available'?available(s.value.months[i]!):s;}),year,field);
      const salaryCents=streamSum(d=>d.kind==='salary','salaryCents'),otherIncomeCents=streamSum(d=>d.kind==='other-income','otherIncomeCents'),rentCents=streamSum(d=>d.kind==='rent','rentCents');
      const grants=rsuYear.status==='available'?rsuYear.value.filter(g=>g.month===month):[];
      const paperIssues=grants.flatMap(grant=>grant.unvestedValueIssue?[grant.unvestedValueIssue]:[]);
      const rsuMonth:Available<RsuPeriod>=rsuYear.status!=='available'?rsuYear:paperIssues.length?{status:'unsupported-case',issues:paperIssues}:range(plan.id,year,'rsu',()=>{
        const total=(key:'taxableIncomeCents'|'withholdingCents'|'unvestedValueCents')=>settleCents(grants.reduce((s,g)=>{const value=g[key];if(value===null)throw new CalculationRangeError();return s.plus(value);},new Decimal(0)));
        return {taxableIncomeCents:total('taxableIncomeCents'),withholdingCents:total('withholdingCents'),unvestedValueCents:total('unvestedValueCents'),grants};
      });
      // Paper-value availability must not prevent independent wages or tax funding.
      const rsuFlow=(key:'taxableIncomeCents'|'withholdingCents'):Available<Cents>=>rsuYear.status==='available'?sum(rsuYear.value.filter(g=>g.month===month).map(g=>available(g[key])),year,`rsu.${key}`):rsuYear;
      const rsuIncomeCents=rsuFlow('taxableIncomeCents'),rsuWithholdingCents=rsuFlow('withholdingCents');
      const ordinaryExpensesCents=streamSum(d=>d.kind==='expense'&&!('propertyId' in d&&d.propertyId),'ordinaryExpensesCents'),propertyExpensesCents=streamSum(d=>d.kind==='expense'&&!!('propertyId' in d&&d.propertyId),'propertyExpensesCents');
      const cashIncomeCents=sum([salaryCents,otherIncomeCents,rentCents],year,'cashIncomeCents');
      const grossIncomeCents=sum([cashIncomeCents,rsuIncomeCents],year,'grossIncomeCents'),knownExpensesCents=sum([ordinaryExpensesCents,propertyExpensesCents],year,'expensesCents');
      const monthCash=aduContext.projects.map(p=>p.months[i]!.cashComplete);
      const expensesCents=combine([knownExpensesCents,...monthCash],()=>numeric(knownExpensesCents));
      const monthlyRecords=records.filter(r=>r.month===month);
      const monthSales=brokerage?.status==='available'?brokerage.value.sales.filter(s=>Number(s.date.slice(5,7))===month):[];
      const unresolvedRequests=[...requestResults.values()].filter(r=>r.status!=='available');
      const requestedContributionCents=sum([...monthlyRecords.map(r=>available(r.requestedCents)),...unresolvedRequests],year,'requestedContributionCents');
      const eligibleContributionCents=sum([...monthlyRecords.map(r=>r.eligibleCents),...unresolvedRequests],year,'eligibleContributionCents');
      const preventedContributionCents=sum([...monthlyRecords.map(r=>r.preventedCents),...unresolvedRequests],year,'preventedContributionCents');
      const accounts:AccountProjection[]=[...plan.accounts].sort((a,b)=>a.id.localeCompare(b.id)).map(account=>{
        if(account.type==='rsu') {
          const schedule=rsuByAccount.get(account.id)!;
          const accountMonth=schedule.status==='available'?schedule.value.filter(g=>g.month===month):[];
          const amount=(key:'openingValueCents'|'growthCents'|'closingValueCents'|'vestedValueCents'|'withholdingCents'):Available<Cents>=>schedule.status==='available'?sum(accountMonth.map(g=>available(g[key])),year,key,account.id):schedule;
          return {accountId:account.id,openingCents:amount('openingValueCents'),contributionCents:available(0),growthCents:amount('growthCents'),closingCents:amount('closingValueCents'),vestedCents:amount('vestedValueCents'),withholdingCents:amount('withholdingCents')};
        }
        const previous=accountExact.get(account.id)!;
        if(fundedAccountIds.has(account.id)&&brokerage){
          if(brokerage.status!=='available'){
            accountExact.set(account.id,brokerage);brokerageBasis.set(account.id,brokerage);
            return{accountId:account.id,openingCents:previous.status==='available'?available(settleCents(previous.value)):previous,contributionCents:brokerage,growthCents:brokerage,closingCents:brokerage,withdrawalCents:brokerage,realizedGainCents:brokerage,openingTaxableBasisCents:brokerage,closingTaxableBasisCents:brokerage,basisConsumedCents:brokerage};
          }
          const ledger=brokerage.value.accounts.find(a=>a.accountId===account.id)!.months[i]!;
          accountExact.set(account.id,available(ledger.closingExact));brokerageBasis.set(account.id,available(ledger.closingBasisCents));
          return{accountId:account.id,openingCents:available(ledger.openingCents),contributionCents:available(ledger.contributionCents),growthCents:available(ledger.growthCents),closingCents:available(ledger.closingCents),withdrawalCents:available(ledger.grossSaleCents),realizedGainCents:available(ledger.realizedGainCents),basisConsumedCents:available(ledger.basisConsumedCents),openingTaxableBasisCents:available(ledger.openingBasisCents),closingTaxableBasisCents:available(ledger.closingBasisCents)};
        }
        const unresolved=[...plan.contributions.filter(c=>c.accountId===account.id).map(c=>requestResults.get(c.id)!),...allocationSources.filter(source=>source.destination.kind==='account'&&(source.destination.backdoorRoth?.traditionalIraAccountId??source.destination.accountId)===account.id).map(source=>requestResults.get(source.id)!)].filter(r=>r.status!=='available');
        const contributionCents=sum([...monthlyRecords.filter(r=>r.accountId===account.id).map(r=>r.eligibleCents),...unresolved],year,'contributionCents',account.id);
        const conversionSources=allocationSources.filter(source=>source.destination.kind==='account'&&source.destination.backdoorRoth&&(source.destination.accountId===account.id||source.destination.backdoorRoth.traditionalIraAccountId===account.id));
        const unresolvedConversions=conversionSources.map(source=>requestResults.get(source.id)!).filter(r=>r.status!=='available');
        const conversionInCents=sum([...monthlyRecords.filter(r=>r.conversionRothAccountId===account.id).map(r=>r.eligibleCents),...unresolvedConversions],year,'conversionInCents',account.id);
        const conversionOutCents=sum([...monthlyRecords.filter(r=>r.accountId===account.id&&r.conversionRothAccountId).map(r=>r.eligibleCents),...unresolvedConversions],year,'conversionOutCents',account.id);
        const conversions=conversionSources.length?{conversionInCents,conversionOutCents}:{};
        const netDepositCents=sum([contributionCents,conversionInCents,conversionOutCents.status==='available'?available(-conversionOutCents.value):conversionOutCents],year,'netDepositCents',account.id);
        const openingCents=previous.status==='available'?range(account.id,year,'openingCents',()=>settleCents(previous.value)):previous;
        if(previous.status!=='available')return {accountId:account.id,openingCents,contributionCents,growthCents:previous,closingCents:previous,...conversions};
        const growth=range(account.id,year,'growthCents',()=>growMonth(previous.value,account.annualGrowthBps,netDepositCents.status==='available'?netDepositCents.value:0));
        const growthCents=growth.status==='available'?available(growth.value.growthCents):growth;
        const closingCents:Available<Cents>=growth.status!=='available'?growth:netDepositCents.status!=='available'?netDepositCents:available(growth.value.closingCents);
        if(growth.status==='available'&&netDepositCents.status==='available')accountExact.set(account.id,available(growth.value.closingExact));
        else if(closingCents.status!=='available')accountExact.set(account.id,closingCents);
        const tracked=brokerageBasis.get(account.id);
        const basis=tracked?{openingTaxableBasisCents:tracked,closingTaxableBasisCents:sum([tracked,contributionCents],year,'closingTaxableBasisCents',account.id),withdrawalCents:available(0),realizedGainCents:available(0),basisConsumedCents:available(0)}:{};
        if(basis.closingTaxableBasisCents)brokerageBasis.set(account.id,basis.closingTaxableBasisCents);
        return {accountId:account.id,openingCents,contributionCents,growthCents,closingCents,...conversions,...basis};
      });
      const loans:LoanProjection[]=declaredLoans.map((descriptor,index)=>{
        const {loan}=descriptor;
        const schedule=yearLoans[index]!;
        if(schedule.status!=='available'){
          const active=descriptor.kind==='adu-project'&&descriptor.loan.draws.every(d=>d.month>`${year}-${String(month).padStart(2,'0')}`);
          const value=active?available(0):schedule;
          return {...(descriptor.kind==='adu-project'?{drawCents:active?available(0):schedule}:{}),loanId:loan.id,openingPrincipalCents:value,interestCents:value,paymentCents:value,principalPaidCents:value,closingPrincipalCents:value};
        }
        const m=schedule.value.months[i]!;return {...(descriptor.kind==='adu-project'?{drawCents:available((m as AduLoanMonth).drawCents)}:'drawCents' in m&&typeof m.drawCents==='number'?{drawCents:available(m.drawCents)}:{}),loanId:loan.id,openingPrincipalCents:available(m.openingPrincipalCents),interestCents:available(m.interestCents),paymentCents:available(m.paymentCents),principalPaidCents:available(m.principalPaidCents),closingPrincipalCents:available(m.closingPrincipalCents)};
      });
      const properties:PropertyProjection[]=[...plan.properties].sort((a,b)=>a.id.localeCompare(b.id)).map(property=>{
        const previous=propertyExact.get(property.id)!,knownHome=existingHomeExact.get(property.id)!;
        const growth=previous.status==='available'?range(property.id,year,'propertyGrowthCents',()=>growMonth(previous.value,propertyRate(property,year),0)):previous;
        const existingGrowth=knownHome.status==='available'?range(property.id,year,'knownExistingHomeValueCents',()=>growMonth(knownHome.value,propertyRate(property,year),0)):knownHome;
        existingHomeExact.set(property.id,existingGrowth.status==='available'?available(existingGrowth.value.closingExact):existingGrowth);
        const projectContext=aduContext.projects.find(p=>p.propertyId===property.id),lifecycle=projectContext?.months[i];
        const purchaseValueCents=purchaseIds.has(property.id)&&property.purchaseDate.slice(0,7)===`${year}-${String(month).padStart(2,'0')}`?property.openingValueCents:0;
        const addition=sum([lifecycle?.completionValueAddedCents??available(0),available(purchaseValueCents)],year,'propertyValueAddedCents',property.id);
        const nextExact=combine([growth,addition],()=>growth.status==='available'?growth.value.closingExact.plus(numeric(addition)):new Decimal(0));
        const settled=nextExact.status==='available'?range(property.id,year,'propertyValueCents',()=>settleCents(nextExact.value)):nextExact;
        propertyExact.set(property.id,settled.status==='available'?nextExact:settled);
        const incomplete:Available<never>={status:'needs-data',issues:[{code:'unvalued-adu-work-in-progress',recordId:property.aduProject?.id??property.id,year,field:'propertyValueCents',severity:'warning',explanation:'The construction in progress has no modeled market value until completion.',resolution:'Review the known original-home value and the completion assumption separately.'}]};
        // Simple planning keeps the known home value until completion; it does
        // not invent an additional market value for unfinished construction.
        const estimate=property.aduProject?.taxEstimation?.mode==='simple';
        const openingValueCents=projectContext&&!priorMarketComplete.get(property.id)&&!estimate?incomplete:previous.status==='available'?range(property.id,year,'openingValueCents',()=>settleCents(previous.value)):previous;
        const closingValueCents=lifecycle&&!lifecycle.marketValueComplete&&!estimate?incomplete:settled,growthCents=growth.status==='available'?available(growth.value.growthCents):growth;
        priorMarketComplete.set(property.id,lifecycle?.marketValueComplete??true);
        const linkedLoans=declaredLoans.filter(l=>l.propertyId===property.id).map(l=>loans.find(v=>v.loanId===l.loan.id)!.closingPrincipalCents);
        const loanBalanceCents=sum(linkedLoans,year,'loanBalanceCents',property.id),equityCents=sum([closingValueCents,loanBalanceCents.status==='available'?available(-loanBalanceCents.value):loanBalanceCents],year,'equityCents',property.id);
        const area:Available<number>=property.primaryArea===undefined?{status:'needs-data',issues:[{code:'required-primary-area',recordId:property.id,year,field:'primaryArea',severity:'warning',explanation:'Combined living area requires the original home area.',resolution:'Enter the original home living area in square feet.'}]}:available(property.primaryArea+(property.aduProject&&property.aduProject.completionDate.slice(0,7)<=`${year}-${String(month).padStart(2,'0')}`?property.aduArea??0:0));
        const extra=projectContext?{completionValueAddedCents:lifecycle?.completionValueAddedCents??available(0),knownExistingHomeValueCents:existingGrowth.status==='available'?available(existingGrowth.value.closingCents):existingGrowth,combinedLivingAreaSqFt:area}:{};
        return {propertyId:property.id,openingValueCents,growthCents,closingValueCents,loanBalanceCents,equityCents,...(purchaseIds.has(property.id)?{purchaseValueAddedCents:available(purchaseValueCents)}:{}),...extra};
      });
      const loanBalanceCents=sum(loans.map(l=>l.closingPrincipalCents),year,'loanBalanceCents'),debtPaymentCents=sum(loans.map(l=>l.paymentCents),year,'debtPaymentCents'),interestCents=sum(loans.map(l=>l.interestCents),year,'interestCents'),principalPaidCents=sum(loans.map(l=>l.principalPaidCents),year,'principalPaidCents');
      const accountBalanceCents=sum(accounts.map(a=>a.closingCents),year,'accountBalanceCents'),accountGrowthCents=sum(accounts.map(a=>a.growthCents),year,'accountGrowthCents'),propertyValueCents=sum(properties.map(p=>p.closingValueCents),year,'propertyValueCents'),propertyGrowthCents=sum(properties.map(p=>p.growthCents),year,'propertyGrowthCents'),equityCents=sum(properties.map(p=>p.equityCents),year,'equityCents');
      const federalIncomeTaxCents=federal.status==='available'?available(federal.value[i]!):federal,californiaIncomeTaxCents=california.status==='available'?available(california.value[i]!):california;
      const payrollAmount=(field:'socialSecurityCents'|'medicareCents'|'additionalMedicareCents'|'sdiCents'):Available<Cents>=>payroll.status==='available'?available(payroll.value.months[i]![field]):payroll;
      const socialSecurityCents=payrollAmount('socialSecurityCents'),medicareCents=payrollAmount('medicareCents'),additionalMedicareCents=payrollAmount('additionalMedicareCents'),sdiCents=payrollAmount('sdiCents');
      const totalTaxCents=sum([federalIncomeTaxCents,californiaIncomeTaxCents,socialSecurityCents,medicareCents,additionalMedicareCents,sdiCents],year,'totalTaxCents');
      const cashFlowCents=sum([cashIncomeCents,rsuWithholdingCents,...[totalTaxCents,expensesCents,debtPaymentCents,eligibleContributionCents].map(v=>v.status==='available'?available(-v.value):v)],year,'cashFlowCents');
      const projectRows=aduContext.projects.map(p=>{const stream=streams.get(p.rentalId)!;return projectAduMonth(p,i,stream.status==='available'?available(stream.value.months[i]!):stream,loans.find(l=>l.loanId===plan.properties.find(property=>property.id===p.propertyId)!.aduProject!.financing?.id));});
      const saleTransfer=brokerage&&brokerage.status!=='available'?brokerage:sum(monthSales.map(s=>available(s.grossSaleCents)),year,'brokerageSaleProceedsCents');
      reserve=sum([reserve,cashFlowCents,...projectRows.map(p=>p.financingProceedsCents),saleTransfer],year,'reserveCents');
      const earmarked=sum(projectRows.map(p=>p.earmarkedCashCents),year,'earmarkedCashCents');lastEarmarked=earmarked;
      const unrestricted=sum([reserve,earmarked.status==='available'?available(-earmarked.value):earmarked],year,'unrestrictedCashCents');
      if(unrestricted.status==='available'&&unrestricted.value<0||monthSales.some(s=>s.shortfallCents>0))conditionalOnGap=true;
      const netWorthCents=sum([reserve,accountBalanceCents,propertyValueCents,loanBalanceCents.status==='available'?available(-loanBalanceCents.value):loanBalanceCents],year,'netWorthCents');
      const fundingStatus=unrestricted.status!=='available'?'unavailable':conditionalOnGap?'conditional-on-gap':'funded';
      const row:MonthlyProjection={year,month,date:`${year}-${String(month).padStart(2,'0')}`,fundingStatus,conditionalOnGap,grossIncomeCents,salaryCents,otherIncomeCents,rentCents,ordinaryExpensesCents,propertyExpensesCents,expensesCents,debtPaymentCents,interestCents,principalPaidCents,federalIncomeTaxCents,californiaIncomeTaxCents,socialSecurityCents,medicareCents,additionalMedicareCents,sdiCents,totalTaxCents,requestedContributionCents,eligibleContributionCents,preventedContributionCents,accountBalanceCents,accountGrowthCents,propertyValueCents,propertyGrowthCents,loanBalanceCents,equityCents,cashFlowCents,reserveCents:reserve,netWorthCents,accounts,properties,loans,...(fundedAccountIds.size?{brokerageFunding:{sales:monthSales,...(brokerage&&brokerage.status!=='available'?{issues:brokerage.issues}:{})}}:{}),...(rsuAccounts.length?{rsu:rsuMonth}:{}),tax,household,candidates:household.status==='available'?household.value.candidates:[],coverage,provenance,issues:uniqueIssues([...allIssues.slice(issueStart,fieldIssuesStart),...allIssues.slice(fieldIssuesStart),...coverage.issues,...properties.flatMap(p=>p.closingValueCents.status==='available'?[]:p.closingValueCents.issues)])};
      let finalRow=projectRows.length?{...row,adu:combineAduMonth(projectRows,reserve,cashFlowBeforeInvestments(row),year)}:row;
      if(finalRow.adu&&fundedAccountIds.size)finalRow={...finalRow,adu:{...finalRow.adu,allocationCashFlowCents:sum([finalRow.adu.allocationCashFlowCents,saleTransfer,...monthSales.map(s=>available(-s.residualCents))],year,'allocationCashFlowCents')}};
      if(finalRow.adu){allIssues.push(...[...Object.values(finalRow.adu).filter((v):v is Available<Cents>=>!Array.isArray(v)),...finalRow.adu.projects.flatMap(p=>Object.values(p).filter((v):v is Available<Cents>=>typeof v==='object'))].flatMap(v=>v.status==='available'?[]:v.issues));}
      yearMonths.push(finalRow);months.push(finalRow);
    }
    const summary=summarizeProjectionYear(yearMonths);
    const annual=allocation?{...summary,cashFlowAllocation:allocation.status==='available'?available(allocation.value.report):allocation}:summary;years.push(annual);allIssues.push(...annual.issues);
  }
  const issues=uniqueIssues(allIssues),coverage:Coverage={completeForModeledScope:years.every(y=>y.coverage.completeForModeledScope)&&!issues.some(i=>i.code==='monetary-overflow'),completeHouseholdLiability:years.every(y=>y.coverage.completeHouseholdLiability)&&!issues.some(i=>i.code==='monetary-overflow'),issues:uniqueIssues(years.flatMap(y=>y.coverage.issues))};
  return {planId:plan.id,inputRevision:plan.revision,months,years,contributions,contributionSchedules,taxStates,loanSchedules,cashSchedules,...(rsuAccounts.length?{rsuSchedules}:{}),openingTaxState,closingTaxState:taxState,provenance:uniqueProvenance(allProvenance),coverage,issues};
}
