import type { Cents, Debt, PlanDocument, PropertyLoan, ValidatedPlan } from './model/plan';
import type { Available, Coverage, Issue, RuleProvenance } from './model/results';
import { initialTaxState, type HouseholdTaxState } from './model/tax-state';
import { CalculationRangeError, Decimal, assertMonetaryRange, settleCents, settleSeries } from './money';
import { resolveCashYear, type CashStream, type CashYear } from './cash/income';
import { requestContributions, type ContributionRequest } from './cash/contribution-requests';
import { calculateLoanSchedule, type LoanSchedule, type OpeningLoanProvenance } from './property/loans';
import { buildPropertyFacts } from './property/facts';
import { growMonth, propertyRate } from './growth';
import { validatePlan } from './validation';
import { resolveYearRules } from './rules/projection';
import type { RuleSet } from './rules/types';
import { resolveHouseholdYear, type HouseholdYear } from './tax/comparison';
import { resolveWorkplaceContributions } from './tax/workplace';
import { calculatePayroll, type PayrollYear } from './tax/payroll';
import type { ContributionRecord } from './tax/facts';
import { checkCoverage } from './coverage';
import { calendarDate, parseISODate } from './dates';
import { summarizeProjectionYear } from './reporting';
import type { AccountProjection, LoanProjection, MonthlyProjection, ProjectionResult, PropertyProjection } from './projection-types';
export type * from './projection-types';

/** Allocate assessed annual income tax, independently of payroll withholding. */
export function allocateAnnualTax(liabilityCents: Cents, positiveGrossCashByMonth: readonly Cents[]): readonly Cents[] {
  if(!Number.isSafeInteger(liabilityCents)||liabilityCents<0)throw new RangeError('Annual assessed income tax must be nonnegative integer cents.');
  assertMonetaryRange(new Decimal(liabilityCents));
  if(positiveGrossCashByMonth.length!==12)throw new RangeError('An annual tax allocation requires twelve monthly income weights.');
  for(const weight of positiveGrossCashByMonth) {
    if(!Number.isSafeInteger(weight)||weight<0)throw new RangeError('Monthly income weights must be nonnegative integer cents.');
    assertMonetaryRange(new Decimal(weight));
  }
  const total=positiveGrossCashByMonth.reduce((s,v)=>s.plus(v),new Decimal(0));
  assertMonetaryRange(total);
  return settleSeries(positiveGrossCashByMonth.map(weight=>total.isZero()?new Decimal(liabilityCents).div(12):new Decimal(liabilityCents).mul(weight).div(total)));
}

const available=<T>(value:T):Available<T>=>({status:'available',value});
function combine<T>(values:readonly Available<unknown>[],calculate:()=>T):Available<T> {
  const missing=values.filter(v=>v.status!=='available');
  return missing.length?{status:missing.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:missing.flatMap(v=>v.issues)}:available(calculate());
}
const numeric=(value:Available<Cents>):Cents=>{if(value.status!=='available')throw new Error('Unavailable value used in a calculation.');return value.value;};
const uniqueIssues=(issues:readonly Issue[]):readonly Issue[]=>[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()];
const uniqueProvenance=(values:readonly RuleProvenance[]):readonly RuleProvenance[]=>[...new Map(values.map(p=>[JSON.stringify(p),p])).values()];

/** A validated derived scenario is used only to recover a failed year's independent streams. */
function streamScenario(plan:ValidatedPlan,kind:CashStream['kind'],id:string):ValidatedPlan {
  const document:PlanDocument={...plan,contributions:[],salaries:kind==='salary'?plan.salaries.filter(s=>s.id===id):[],otherIncome:kind==='other-income'?plan.otherIncome.filter(s=>s.id===id):[],expenses:kind==='expense'?plan.expenses.filter(s=>s.id===id):[],rentals:plan.rentals.map(r=>kind==='rent'&&r.id===id?r:{...r,monthlyRentCents:0,rentGrowthBps:0})};
  const result=validatePlan(document);
  if(!result.ok)throw new Error('Independent cash recovery produced an invalid derived scenario.');
  return result.plan;
}

/** Unlinked living expenses do not enter taxable income or property deductions. */
function taxCashScenario(plan:ValidatedPlan):ValidatedPlan {
  const result=validatePlan({...plan,expenses:plan.expenses.filter(e=>e.propertyId||e.rentalId)});
  if(!result.ok)throw new Error('Tax cash recovery produced an invalid derived scenario.');
  return result.plan;
}

function wageCashScenario(plan:ValidatedPlan):ValidatedPlan {
  const result=validatePlan({...plan,contributions:[],otherIncome:plan.otherIncome.filter(o=>o.classification==='wage'),expenses:[],rentals:plan.rentals.map(r=>({...r,monthlyRentCents:0,rentGrowthBps:0}))});
  if(!result.ok)throw new Error('Payroll cash recovery produced an invalid derived scenario.');
  return result.plan;
}

function interruptedTaxState(opening:HouseholdTaxState,year:number,reason:Available<never>):HouseholdTaxState {
  const preserveCredit=(jurisdiction:'federal'|'california')=>{const h=opening.minimumTaxCreditCoverage[jurisdiction];return h.known&&h.value?h:{known:false} as const;};
  return {...opening,year,rentals:Object.fromEntries(Object.entries(opening.rentals).map(([id,books])=>[id,Object.fromEntries(Object.keys(books).map(book=>[book,reason])) as HouseholdTaxState['rentals'][string]])),qbiLossVintages:Object.fromEntries(Object.keys(opening.qbiLossVintages).map(id=>[id,{known:false}])),iraBasisByOwner:Object.fromEntries(Object.keys(opening.iraBasisByOwner).map(id=>[id,{known:false}])),minimumTaxCreditCoverage:{federal:preserveCredit('federal'),california:preserveCredit('california')}};
}

/** Pure monthly scenario. Eligibility precedes deposits; residual cash remains a signed reserve. */
export function calculateProjection(plan:ValidatedPlan,ruleSet:RuleSet):ProjectionResult {
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
  const accountExact=new Map<string,Available<Decimal>>(plan.accounts.map(a=>[a.id,available(new Decimal(a.openingBalanceCents))]));
  const propertyExact=new Map<string,Available<Decimal>>(plan.properties.map(p=>[p.id,available(new Decimal(p.openingValueCents))]));
  const declaredLoans=[...plan.properties.flatMap(p=>p.loans.map(loan=>({loan,propertyId:p.id}))),...plan.debts.map(loan=>({loan,...(loan.propertyId?{propertyId:loan.propertyId}:{})}))].sort((a,b)=>a.loan.id.localeCompare(b.loan.id));
  const loanClosing=new Map<string,Available<Cents>>(),loanOrigin=new Map<string,{opening:OpeningLoanProvenance;payment:OpeningLoanProvenance}>();
  const openingTaxState=initialTaxState(plan);let taxState=openingTaxState,reserve:Available<Cents>=available(plan.openingCashCents),conditionalOnGap=false;
  const streamDefinitions=[...plan.salaries.map(s=>({id:s.id,kind:'salary' as const})),...plan.otherIncome.map(s=>({id:s.id,kind:'other-income' as const})),...plan.expenses.map(s=>({id:s.id,kind:'expense' as const})),...plan.rentals.map(s=>({id:s.id,kind:'rent' as const}))].sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  for(let year=plan.startYear;year<plan.startYear+plan.horizonYears;year++) {
    const issueStart=allIssues.length,opening=taxState;
    const cash=range(plan.id,year,'cash',()=>resolveCashYear(plan,year));
    const streams=new Map<string,Available<CashStream>>();
    for(const definition of streamDefinitions){
      const stream=cash.status==='available'?available(cash.value.streams.find(s=>s.id===definition.id)!):range(definition.id,year,'cashStream',()=>resolveCashYear(streamScenario(plan,definition.kind,definition.id),year).streams.find(s=>s.id===definition.id)!);
      streams.set(definition.id,stream);cashSchedules.push({recordId:definition.id,year,kind:definition.kind,schedule:stream});
    }
    const yearLoans:Available<LoanSchedule>[]=[];
    for(const {loan} of declaredLoans){
      const previous=loanClosing.get(loan.id);let schedule:Available<LoanSchedule>;
      if(previous&&previous.status!=='available')schedule=previous;
      else {
        const continued:Debt|PropertyLoan=previous?.status==='available'?'originalPrincipalCents' in loan?{...loan,openingBalance:{known:true,value:previous.value}}:{...loan,openingBalanceCents:previous.value}:loan;
        schedule=range(loan.id,year,'loanSchedule',()=>calculateLoanSchedule(continued,year,1));
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
    const taxCash=cash.status==='available'?cash:range(plan.id,year,'taxCash',()=>resolveCashYear(taxCashScenario(plan),year));
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
          const subset=validatePlan({...plan,contributions:[rule]});if(!subset.ok)throw new Error('Contribution recovery produced an invalid derived scenario.');
          const source=taxCash.status==='available'?taxCash.value:resolveCashYear(streamScenario(plan,'salary',salaryId),year);
          return requestContributions(subset.plan,source);
        });
      }
      requestResults.set(rule.id,result);contributionSchedules.push({ruleId:rule.id,year,requests:result});
    }
    const knownRequests=[...requestResults.values()].flatMap(r=>r.status==='available'?[...r.value]:[]).sort((a,b)=>a.month-b.month||a.priority-b.priority||a.ruleId.localeCompare(b.ruleId));
    const retirementRequestResults=plan.contributions.filter(r=>plan.accounts.find(a=>a.id===r.accountId)!.type!=='taxable-brokerage').map(r=>requestResults.get(r.id)!);
    const taxLoans=yearLoans.filter((_,index)=>declaredLoans[index]!.propertyId);
    let household:Available<HouseholdYear>=combine([taxCash,rules,...retirementRequestResults,...taxLoans],()=>undefined as never);
    if(household.status==='available'&&taxCash.status==='available'&&rules.status==='available'){
      household=range(plan.id,year,'householdYear',()=>{
        const loans=taxLoans.map(s=>{if(s.status!=='available')throw new Error('Unavailable loan');return s.value;});
        const property=buildPropertyFacts(plan,taxCash.value,loans,opening,rules.value);
        return resolveHouseholdYear(plan,taxCash.value,knownRequests,property,loans,opening,rules.value);
      });
    }
    let records:readonly ContributionRecord[]=[],payroll:Available<PayrollYear>;
    if(household.status==='available'){
      records=household.value.contributions;payroll=available(household.value.payroll);taxState=household.value.closingTaxState;allIssues.push(...household.value.issues);
    }else {
      allIssues.push(...household.issues);taxState=interruptedTaxState(opening,year,household);
      const wageCash=taxCash.status==='available'?taxCash:range(plan.id,year,'wageCash',()=>resolveCashYear(wageCashScenario(plan),year));
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
    contributions.push(...records);taxStates.push({year,opening,closing:taxState});
    const tax=household.status==='available'?household.value.tax:household;
    const incomeAllocation=(jurisdiction:'federal'|'california'):Available<readonly Cents[]>=>tax.status==='available'&&taxCash.status==='available'?range(plan.id,year,`${jurisdiction}IncomeTaxCents`,()=>allocateAnnualTax(tax.value[jurisdiction].totalCents,taxCash.value.positiveGrossCashByMonth)):combine([tax,taxCash],()=>undefined as never);
    const federal=incomeAllocation('federal'),california=incomeAllocation('california');
    const carriedDistributionIssues:Issue[]=plan.household.filers.flatMap(filer=>{
      if(!filer.birthDate.known)return [];
      const birth=parseISODate(filer.birthDate.value).year,age=year-birth,distributionAge=birth>=1960?75:birth>=1951?73:72;
      const deferred=plan.accounts.some(a=>a.ownerId===filer.id&&(a.type==='traditional-ira'||a.type==='traditional-401k')&&accountExact.get(a.id)?.status==='available'&&(accountExact.get(a.id) as {status:'available';value:Decimal}).value.gt(0));
      return deferred&&age>=distributionAge?[{code:'omitted-distributions',recordId:filer.id,year,field:'birthDate',severity:'warning' as const,explanation:'A carried retirement balance reaches an age at which this contribution-and-growth scenario omits potentially required distributions.',resolution:'Treat household liability as incomplete and model retirement distributions separately.'}]:[];
    });
    allIssues.push(...carriedDistributionIssues);
    const baseCoverage=household.status==='available'?household.value.coverage:checkCoverage(plan,year);
    const coverage:Coverage={completeForModeledScope:baseCoverage.completeForModeledScope&&household.status==='available',completeHouseholdLiability:baseCoverage.completeHouseholdLiability&&household.status==='available'&&carriedDistributionIssues.length===0,issues:uniqueIssues([...baseCoverage.issues,...carriedDistributionIssues,...(household.status==='available'?[]:household.issues)])};
    const provenance=rules.status==='available'?uniqueProvenance(Object.values(rules.value.provenance)):[];
    const yearMonths:MonthlyProjection[]=[];
    for(let month=1;month<=12;month++){
      const fieldIssuesStart=allIssues.length,i=month-1;
      const streamSum=(predicate:(definition:typeof streamDefinitions[number])=>boolean,field:string):Available<Cents>=>sum(streamDefinitions.filter(predicate).map(d=>{const s=streams.get(d.id)!;return s.status==='available'?available(s.value.months[i]!):s;}),year,field);
      const salaryCents=streamSum(d=>d.kind==='salary','salaryCents'),otherIncomeCents=streamSum(d=>d.kind==='other-income','otherIncomeCents'),rentCents=streamSum(d=>d.kind==='rent','rentCents');
      const ordinaryExpensesCents=streamSum(d=>d.kind==='expense'&&!plan.expenses.find(e=>e.id===d.id)?.propertyId,'ordinaryExpensesCents'),propertyExpensesCents=streamSum(d=>d.kind==='expense'&&!!plan.expenses.find(e=>e.id===d.id)?.propertyId,'propertyExpensesCents');
      const grossIncomeCents=sum([salaryCents,otherIncomeCents,rentCents],year,'grossIncomeCents'),expensesCents=sum([ordinaryExpensesCents,propertyExpensesCents],year,'expensesCents');
      const monthlyRecords=records.filter(r=>r.month===month);
      const unresolvedRequests=[...requestResults.values()].filter(r=>r.status!=='available');
      const requestedContributionCents=sum([...monthlyRecords.map(r=>available(r.requestedCents)),...unresolvedRequests],year,'requestedContributionCents');
      const eligibleContributionCents=sum([...monthlyRecords.map(r=>r.eligibleCents),...unresolvedRequests],year,'eligibleContributionCents');
      const preventedContributionCents=sum([...monthlyRecords.map(r=>r.preventedCents),...unresolvedRequests],year,'preventedContributionCents');
      const accounts:AccountProjection[]=[...plan.accounts].sort((a,b)=>a.id.localeCompare(b.id)).map(account=>{
        const previous=accountExact.get(account.id)!;
        const unresolved=plan.contributions.filter(c=>c.accountId===account.id).map(c=>requestResults.get(c.id)!).filter(r=>r.status!=='available');
        const contributionCents=sum([...monthlyRecords.filter(r=>r.accountId===account.id).map(r=>r.eligibleCents),...unresolved],year,'contributionCents',account.id);
        const openingCents=previous.status==='available'?range(account.id,year,'openingCents',()=>settleCents(previous.value)):previous;
        if(previous.status!=='available')return {accountId:account.id,openingCents,contributionCents,growthCents:previous,closingCents:previous};
        const growth=range(account.id,year,'growthCents',()=>growMonth(previous.value,account.annualGrowthBps,contributionCents.status==='available'?contributionCents.value:0));
        const growthCents=growth.status==='available'?available(growth.value.growthCents):growth;
        const closingCents:Available<Cents>=growth.status!=='available'?growth:contributionCents.status!=='available'?contributionCents:available(growth.value.closingCents);
        if(growth.status==='available'&&contributionCents.status==='available')accountExact.set(account.id,available(growth.value.closingExact));
        else if(closingCents.status!=='available')accountExact.set(account.id,closingCents);
        return {accountId:account.id,openingCents,contributionCents,growthCents,closingCents};
      });
      const loans:LoanProjection[]=declaredLoans.map(({loan},index)=>{
        const schedule=yearLoans[index]!;
        if(schedule.status!=='available')return {loanId:loan.id,openingPrincipalCents:schedule,interestCents:schedule,paymentCents:schedule,principalPaidCents:schedule,closingPrincipalCents:schedule};
        const m=schedule.value.months[i]!;return {loanId:loan.id,openingPrincipalCents:available(m.openingPrincipalCents),interestCents:available(m.interestCents),paymentCents:available(m.paymentCents),principalPaidCents:available(m.principalPaidCents),closingPrincipalCents:available(m.closingPrincipalCents)};
      });
      const properties:PropertyProjection[]=[...plan.properties].sort((a,b)=>a.id.localeCompare(b.id)).map(property=>{
        const previous=propertyExact.get(property.id)!;
        const growth=previous.status==='available'?range(property.id,year,'propertyGrowthCents',()=>growMonth(previous.value,propertyRate(property,year),0)):previous;
        const openingValueCents=previous.status==='available'?range(property.id,year,'openingValueCents',()=>settleCents(previous.value)):previous;
        const closingValueCents=growth.status==='available'?available(growth.value.closingCents):growth,growthCents=growth.status==='available'?available(growth.value.growthCents):growth;
        propertyExact.set(property.id,growth.status==='available'?available(growth.value.closingExact):growth);
        const linkedLoans=declaredLoans.filter(l=>l.propertyId===property.id).map(l=>loans.find(v=>v.loanId===l.loan.id)!.closingPrincipalCents);
        const loanBalanceCents=sum(linkedLoans,year,'loanBalanceCents',property.id),equityCents=sum([closingValueCents,loanBalanceCents.status==='available'?available(-loanBalanceCents.value):loanBalanceCents],year,'equityCents',property.id);
        return {propertyId:property.id,openingValueCents,growthCents,closingValueCents,loanBalanceCents,equityCents};
      });
      const loanBalanceCents=sum(loans.map(l=>l.closingPrincipalCents),year,'loanBalanceCents'),debtPaymentCents=sum(loans.map(l=>l.paymentCents),year,'debtPaymentCents'),interestCents=sum(loans.map(l=>l.interestCents),year,'interestCents'),principalPaidCents=sum(loans.map(l=>l.principalPaidCents),year,'principalPaidCents');
      const accountBalanceCents=sum(accounts.map(a=>a.closingCents),year,'accountBalanceCents'),accountGrowthCents=sum(accounts.map(a=>a.growthCents),year,'accountGrowthCents'),propertyValueCents=sum(properties.map(p=>p.closingValueCents),year,'propertyValueCents'),propertyGrowthCents=sum(properties.map(p=>p.growthCents),year,'propertyGrowthCents'),equityCents=sum(properties.map(p=>p.equityCents),year,'equityCents');
      const federalIncomeTaxCents=federal.status==='available'?available(federal.value[i]!):federal,californiaIncomeTaxCents=california.status==='available'?available(california.value[i]!):california;
      const payrollAmount=(field:'socialSecurityCents'|'medicareCents'|'additionalMedicareCents'|'sdiCents'):Available<Cents>=>payroll.status==='available'?available(payroll.value.months[i]![field]):payroll;
      const socialSecurityCents=payrollAmount('socialSecurityCents'),medicareCents=payrollAmount('medicareCents'),additionalMedicareCents=payrollAmount('additionalMedicareCents'),sdiCents=payrollAmount('sdiCents');
      const totalTaxCents=sum([federalIncomeTaxCents,californiaIncomeTaxCents,socialSecurityCents,medicareCents,additionalMedicareCents,sdiCents],year,'totalTaxCents');
      const cashFlowCents=sum([grossIncomeCents,...[totalTaxCents,expensesCents,debtPaymentCents,eligibleContributionCents].map(v=>v.status==='available'?available(-v.value):v)],year,'cashFlowCents');
      reserve=sum([reserve,cashFlowCents],year,'reserveCents');if(reserve.status==='available'&&reserve.value<0)conditionalOnGap=true;
      const netWorthCents=sum([reserve,accountBalanceCents,propertyValueCents,loanBalanceCents.status==='available'?available(-loanBalanceCents.value):loanBalanceCents],year,'netWorthCents');
      const fundingStatus=reserve.status!=='available'?'unavailable':conditionalOnGap?'conditional-on-gap':'funded';
      const row:MonthlyProjection={year,month,date:`${year}-${String(month).padStart(2,'0')}`,fundingStatus,conditionalOnGap,grossIncomeCents,salaryCents,otherIncomeCents,rentCents,ordinaryExpensesCents,propertyExpensesCents,expensesCents,debtPaymentCents,interestCents,principalPaidCents,federalIncomeTaxCents,californiaIncomeTaxCents,socialSecurityCents,medicareCents,additionalMedicareCents,sdiCents,totalTaxCents,requestedContributionCents,eligibleContributionCents,preventedContributionCents,accountBalanceCents,accountGrowthCents,propertyValueCents,propertyGrowthCents,loanBalanceCents,equityCents,cashFlowCents,reserveCents:reserve,netWorthCents,accounts,properties,loans,tax,household,candidates:household.status==='available'?household.value.candidates:[],coverage,provenance,issues:uniqueIssues([...allIssues.slice(issueStart,fieldIssuesStart),...allIssues.slice(fieldIssuesStart),...coverage.issues])};
      yearMonths.push(row);months.push(row);
    }
    const annual=summarizeProjectionYear(yearMonths);years.push(annual);allIssues.push(...annual.issues);
  }
  const issues=uniqueIssues(allIssues),coverage:Coverage={completeForModeledScope:years.every(y=>y.coverage.completeForModeledScope)&&!issues.some(i=>i.code==='monetary-overflow'),completeHouseholdLiability:years.every(y=>y.coverage.completeHouseholdLiability)&&!issues.some(i=>i.code==='monetary-overflow'),issues:uniqueIssues(years.flatMap(y=>y.coverage.issues))};
  return {planId:plan.id,inputRevision:plan.revision,months,years,contributions,contributionSchedules,taxStates,loanSchedules,cashSchedules,openingTaxState,closingTaxState:taxState,provenance:uniqueProvenance(allProvenance),coverage,issues};
}
