import {calendarDate} from '../dates';
import {resolveCashYear} from '../cash/income';
import type {CashYear} from '../cash/income';
import {CalculationRangeError,Decimal,settleCents} from '../money';
import type {AduProject,AduTaxSplit,Cents,History,Property,RentalBookState,RentalUnit,TaxBook,ValidatedPlan} from '../model/plan';
import type {Available,Issue,RuleProvenance} from '../model/results';
import type {AduCapitalBookState,HouseholdTaxState} from '../model/tax-state';
import type {YearRules} from '../rules/types';
import {aduPlanningProvenance} from '../rules/adu-planning-v1';
import {allocateAduSharedExpense} from './adu-allocation';
import {calculateAduDepreciation} from './adu-depreciation';
import type {DepreciationYear} from './depreciation';
import type {RentalCashField,RentalTaxBookFacts,RentalYearFacts} from './facts';
import type {AduProjectYear,AduYear} from './adu-lifecycle';
import {getAduProjects} from './adu-ownership';
export type {AduCapitalBookState} from '../model/tax-state';
export interface AduRiskMovements {readonly ownerCapitalCents:Cents;readonly qualifiedBorrowingCents:Cents;readonly ownerSupportCents:Cents;readonly nondeductibleExpenseCents:Cents}
export interface PreparedAduTaxYear {
  readonly opening:HouseholdTaxState;readonly capitalClosing:NonNullable<HouseholdTaxState['aduProjects']>;
  readonly rentalFacts:readonly RentalYearFacts[];readonly issues:readonly Issue[];readonly provenance:readonly RuleProvenance[];
}
const books:readonly TaxBook[]=['federal','california','federal-amt','california-amt'];
const available=<T>(value:T):Available<T>=>({status:'available',value});
const sum=(values:readonly Cents[]):Cents=>settleCents(values.reduce((total,v)=>total.plus(v),new Decimal(0)));
const zeroCapital:AduCapitalBookState={capitalizedBuildingCents:0,nondepreciableBasisCents:0,recoveryActivated:false};
function failure(project:AduProject,year:number,field:string,code:string,explanation:string,status:'needs-data'|'unsupported-case'='needs-data'):Available<never>{
  return {status,issues:[{code,recordId:project.id,year,field,severity:'warning',explanation,resolution:'Confirm the supported project treatment, qualifications and funding, or supply the separate recovery schedule.'}]};
}
function combine<T>(operands:readonly Available<unknown>[],calculate:()=>T):Available<T>{
  const missing=operands.filter(x=>x.status!=='available');return missing.length?{status:missing.some(x=>x.status==='unsupported-case')?'unsupported-case':'needs-data',issues:missing.flatMap(x=>x.issues)}:available(calculate());
}
function qualification(project:AduProject,year:number,field:string,answer:History<boolean>):Available<true>{
  return !answer.known?failure(project,year,field,'required-adu-tax-qualification','The relevant qualification is unanswered.'):!answer.value?failure(project,year,field,'unsupported-adu-tax-treatment','This treatment is outside the confirmed ordinary project contract.','unsupported-case'):available(true);
}
/** Physical work alone does not activate future rental qualifications when cash taxes are confirmed zero. */
export function aduTaxActivityStarted(plan:ValidatedPlan,property:Property,year:number):boolean {
  const project=property.aduProject!,rental=plan.rentals.find(u=>u.id===project.rentalId)!,end=`${year}-12-31`;
  const dates=[rental.availableDate,...project.costs.filter(c=>c.amountCents>0).map(c=>c.paymentDate),...(project.financing?.draws.filter(d=>d.amountCents>0).map(d=>`${d.month}-01`)??[]),
    ...project.propertyTax.paymentYears.flatMap(row=>row.payments.filter(p=>p.amountCents>0).map(p=>`${p.month}-01`)),...plan.expenses.filter(e=>e.rentalId===rental.id&&e.amountCents>0).map(e=>e.startDate)];
  const schedule=project.propertyTax.paymentYears.find(row=>row.year===year);
  if(project.constructionStartDate<=end&&(!schedule?.complete.known||!schedule.complete.value))return true;
  return dates.some(date=>date<=end);
}
function unitQualification(project:AduProject,unit:RentalUnit,year:number):Available<true>{
  const checks=(['ordinaryResidential','longTermFairMarketLease','noPersonalUse','noSubstantialTenantServices','advancedBasisAdjustments'] as const).map(key=>{
    const answer=unit.qualifications[key];return qualification(project,year,`qualifications.${key}`,key==='advancedBasisAdjustments'&&answer.known?{known:true,value:!answer.value}:answer);
  });return combine(checks,()=>true as const);
}
interface OperatingCash {readonly paid:readonly Cents[];readonly deductible:readonly Cents[];readonly nondeductible:readonly Cents[];readonly capital:readonly Cents[];readonly rent:readonly Cents[]}
function operatingCash(plan:ValidatedPlan,property:Property,unit:RentalUnit,year:number):Available<OperatingCash>{
  const project=property.aduProject!,originalIds=new Set(project.sharedExpenseOverrides.map(o=>o.expenseId));
  const expenses=plan.expenses.filter(e=>e.rentalId===unit.id||unit.availableDate<=`${year}-12-31`&&originalIds.has(e.id));
  let cash:CashYear;
  try{cash=resolveCashYear(plan,year,{streamIds:new Set([unit.id,...expenses.map(e=>e.id)])});}
  catch(error){if(!(error instanceof CalculationRangeError))throw error;return failure(project,year,'operatingExpenseCents','monetary-overflow',error.message);}
  const rows=expenses.map(e=>({expense:e,allocation:allocateAduSharedExpense(e,property,unit,cash.streams.find(s=>s.id===e.id)!.months,year)}));
  return combine(rows.map(r=>r.allocation),()=>{
    const category=(predicate:(e:typeof expenses[number])=>boolean):readonly Cents[]=>Array.from({length:12},(_,month)=>sum(rows.filter(r=>predicate(r.expense)).map(r=>r.allocation.status==='available'?r.allocation.value[month]!.rentalCentsByUnit[unit.id]??0:0)));
    return {paid:category(()=>true),deductible:category(e=>e.taxCategory!=='personal'&&e.taxCategory!=='capital'),nondeductible:category(e=>e.taxCategory==='personal'),capital:category(e=>e.taxCategory==='capital'),rent:cash.streams.find(s=>s.id===unit.id)!.months};
  });
}
interface BookPrepared {
  readonly capital:Available<AduCapitalBookState>;readonly opening:Available<RentalBookState>;
  readonly depreciation:Available<DepreciationYear>;readonly facts:Available<RentalTaxBookFacts>;
  readonly risk:Available<AduRiskMovements>;readonly eligibleInterest:Available<Cents>;
}
function prepareBook(plan:ValidatedPlan,project:AduProject,unit:RentalUnit,context:AduProjectYear,book:TaxBook,opening:HouseholdTaxState,rules:YearRules,operating:Available<OperatingCash>):BookPrepared {
  const year=rules.year,prior=opening.rentals[unit.id]?.[book]??failure(project,year,`taxHistory.${book}`,'required-history','The carried new-rental book is missing.');
  const capPrior=opening.aduProjects?.[project.id]?.[book]??(opening.year<plan.startYear?available(zeroCapital):failure(project,year,`aduProjects.${book}`,'required-adu-capital-history','The carried project capital ledger is missing.'));
  const zeroSplit=():AduTaxSplit=>({buildingBasisCents:0,currentDeductionCents:0,nondepreciableBasisCents:0,nondeductibleExpenseCents:0});
  const events:{split:Available<AduTaxSplit>;interest:boolean;month:string;date?:string}[]=[];
  const validateSplit=(answer:History<AduTaxSplit>|undefined,amount:Cents,field:string):Available<AduTaxSplit>=>{
    if(amount===0)return available(zeroSplit());
    if(!answer?.known)return failure(project,year,field,'required-adu-tax-treatment','A paid amount has no confirmed tax-book split.');
    if(!new Decimal(answer.value.buildingBasisCents).plus(answer.value.currentDeductionCents).plus(answer.value.nondepreciableBasisCents).plus(answer.value.nondeductibleExpenseCents).eq(amount))return failure(project,year,field,'unreconciled-adu-interest-treatment','The tax-book split does not reconcile to the scheduled cash payment.');
    return available(answer.value);
  };
  for(const cost of project.costs.filter(c=>c.paymentDate.startsWith(`${year}-`))){
    let split=validateSplit(cost.treatments[book],cost.amountCents,`costs.${cost.id}.treatments.${book}`);
    if(split.status==='available'&&cost.category==='land'&&
      (split.value.buildingBasisCents>0||split.value.currentDeductionCents>0))
      split=failure(project,year,`costs.${cost.id}.treatments.${book}`,'unsupported-adu-land-recovery','Land acquisition costs are nondepreciable and cannot enter building recovery or a current deduction.','unsupported-case');
    // Other components have no separate classification or recovery method in
    // this contract. A confirmed split cannot establish that missing method.
    if(split.status==='available'&&cost.category==='other'&&
      (split.value.buildingBasisCents>0||split.value.nondepreciableBasisCents>0||split.value.currentDeductionCents>0))
      split=failure(project,year,`costs.${cost.id}.treatments.${book}`,'unsupported-adu-component-recovery','Other components require a separately supported classification and recovery schedule.','unsupported-case');
    // Borrowing fees/points need their own loan-term recovery and, where eligible,
    // period-accrued construction-interest treatment. This ledger cannot recover an
    // entire upfront fee as building cost or infer an immediate deduction (Pub 551/527).
    if(split.status==='available'&&cost.category==='financing-fee'&&
      (split.value.buildingBasisCents>0||split.value.nondepreciableBasisCents>0||split.value.currentDeductionCents>0))
      split=failure(project,year,`costs.${cost.id}.treatments.${book}`,'unsupported-adu-financing-fee-recovery','Borrowing fees and points require a separate loan-term recovery schedule.','unsupported-case');
    events.push({split,interest:false,month:cost.paymentDate.slice(0,7),date:cost.paymentDate});
  }
  for(const row of project.propertyTax.paymentYears.filter(row=>row.year===year))for(const payment of row.payments)events.push({split:validateSplit(payment.treatments[book],payment.amountCents,`propertyTax.${payment.id}.treatments.${book}`),interest:false,month:payment.month});
  const loan=context.loan;
  const loanMonths=loan?.status==='available'?loan.value.months.filter(m=>m.date.startsWith(`${year}-`)):[];
  const interestByMonth=Array.from({length:12},(_,index)=>loanMonths[index]?.interestCents??0);
  const principalByMonth=Array.from({length:12},(_,index)=>loanMonths[index]?.principalPaidCents??0);
  const loanMechanical:Available<true>=loan&&loan.status!=='available'?loan:available(true);
  const trace=project.financing&&sum(interestByMonth)>0?combine([qualification(project,year,'financing.proceedsHistoryComplete',project.financing.proceedsHistoryComplete),qualification(project,year,'financing.rentalInterestQualified',project.financing.rentalInterestQualified)],()=>true as const):available(true);
  for(let index=0;index<12;index++){
    const amount=interestByMonth[index]!;if(amount===0)continue;
    const month=`${year}-${String(index+1).padStart(2,'0')}`,row=project.financing!.interestTaxRows.find(r=>r.month===month);
    let split:Available<AduTaxSplit>;
    if(row)split=validateSplit(row.treatments[book],amount,`financing.interestTaxRows.${row.id}.${book}`);
    else if(`${month}-01`>=unit.availableDate)split=available({...zeroSplit(),currentDeductionCents:amount});
    else split=failure(project,year,`financing.interestTaxRows.${month}.${book}`,'required-adu-interest-treatment','Pre-readiness or transition-month interest needs an explicit eligible split.');
    split=combine([split,trace],()=>split.status==='available'?split.value:zeroSplit());
    if(split.status==='available'&&split.value.buildingBasisCents+split.value.nondepreciableBasisCents>0){
      const period=project.productionPeriod;
      if(!period.known)split=failure(project,year,'productionPeriod','required-adu-production-period','Capitalized interest requires a confirmed physical production period.');
      else if(!period.value.uninterrupted||period.value.startDate>calendarDate(year,index+1,31)||period.value.endDate<`${month}-01`)split=failure(project,year,'productionPeriod','unsupported-adu-production-period','This interest capitalization is outside the supported uninterrupted production period.','unsupported-case');
    }
    events.push({split,interest:true,month});
  }
  const treatment=combine(events.map(e=>e.split),()=>{
    const category=(key:keyof AduTaxSplit,interest?:boolean):Cents=>sum(events.filter(e=>interest===undefined||e.interest===interest).map(e=>e.split.status==='available'?e.split.value[key]:0));
    return {building:category('buildingBasisCents'),land:category('nondepreciableBasisCents'),current:category('currentDeductionCents',false),interest:category('currentDeductionCents',true),nondeductible:category('nondeductibleExpenseCents')};
  });
  const wasActivated=capPrior.status==='available'&&capPrior.value.recoveryActivated;
  const taxBasisIssues=context.months.filter(m=>`${year}-${String(m.month).padStart(2,'0')}`<=unit.availableDate.slice(0,7)).flatMap(m=>m.cashComplete.status==='available'?[]:m.cashComplete.issues.filter(i=>i.field==='propertyTax.paymentYears'));
  const taxBasisComplete:Available<true>=taxBasisIssues.length?{status:'needs-data',issues:taxBasisIssues}:available(true);
  let capital:Available<AduCapitalBookState>=wasActivated?capPrior:combine([capPrior,treatment,taxBasisComplete,loanMechanical],()=>({capitalizedBuildingCents:sum([capPrior.status==='available'?capPrior.value.capitalizedBuildingCents:0,treatment.status==='available'?treatment.value.building:0]),nondepreciableBasisCents:sum([capPrior.status==='available'?capPrior.value.nondepreciableBasisCents:0,treatment.status==='available'?treatment.value.land:0]),recoveryActivated:capPrior.status==='available'&&capPrior.value.recoveryActivated}));
  let extra:Available<true>=available(true);
  if(events.some(e=>{
    if(e.split.status!=='available'||e.split.value.buildingBasisCents===0&&e.split.value.nondepreciableBasisCents===0)return false;
    const alreadyActive=capPrior.status==='available'&&capPrior.value.recoveryActivated;
    return alreadyActive||(e.date?e.date>unit.availableDate:e.month>unit.availableDate.slice(0,7));
  })){
    extra=failure(project,year,`aduProjects.${book}`,'unsupported-adu-extra-recovery','New capital after readiness requires a separate recovery schedule.','unsupported-case');capital=capPrior;
  }
  const qualified=combine([qualification(project,year,`taxQualifications.${book}`,project.taxQualifications[book]),unitQualification(project,unit,year)],()=>true as const);
  if(!wasActivated&&qualified.status!=='available'&&events.some(e=>e.split.status==='available'&&(e.split.value.buildingBasisCents>0||e.split.value.nondepreciableBasisCents>0||e.split.value.currentDeductionCents>0)))capital=qualified;
  let preparedOpening=prior;
  if(capital.status==='available'&&!capital.value.recoveryActivated&&unit.availableDate<=`${year}-12-31`){
    if(unit.availableDate<`${year}-01-01`)preparedOpening=failure(project,year,`taxHistory.${book}`,'required-adu-recovery-history','Prior readiness must already have activated the carried recovery book.');
    else if(prior.status==='available'){
      preparedOpening=available({...prior.value,recoveryBasisCents:capital.value.capitalizedBuildingCents,adjustedBuildingBasisCents:capital.value.capitalizedBuildingCents,cumulativeDepreciationCents:0});capital=available({...capital.value,recoveryActivated:true});
    }
  }
  const depreciation=combine([preparedOpening,capital],()=>undefined as never).status==='available'?calculateAduDepreciation({unit,year,book,opening:preparedOpening,rules}):combine<DepreciationYear>([preparedOpening,capital],()=>undefined as never);
  const contextComplete=context.months.map(m=>m.cashComplete);
  const eligibleInterest=combine([treatment,trace,loanMechanical],()=>treatment.status==='available'?treatment.value.interest:0);
  let support:Available<Cents>=combine([operating,loanMechanical,...contextComplete],()=>{
    const cash=operating.status==='available'?operating.value:undefined;
    const deficit=sum(Array.from({length:12},(_,index)=>Math.max(0,sum([cash?.paid[index]??0,context.months[index]!.projectTaxPaidCents,interestByMonth[index]!,principalByMonth[index]!,-(cash?.rent[index]??0)]))));
    return deficit;
  });
  if(support.status==='available'&&support.value>0){const answer=project.supportOperatingDeficits;support=!answer.known?failure(project,year,'supportOperatingDeficits','required-adu-owner-support','The activity cash deficit, including principal, has no confirmed owner-support assumption.'):available(answer.value?support.value:0);}
  const drawn=sum(context.months.map(m=>m.financingProceedsCents));
  const borrowed:Available<Cents>=drawn===0?available(0):combine(project.financing?[qualification(project,year,'financing.proceedsHistoryComplete',project.financing.proceedsHistoryComplete),qualification(project,year,'financing.financingAtRiskQualification',project.financing.financingAtRiskQualification)]:[],()=>drawn);
  const risk=combine([treatment,operating,support,borrowed,...contextComplete],()=>({ownerCapitalCents:sum(context.months.map(m=>m.ownerConstructionCents)),qualifiedBorrowingCents:borrowed.status==='available'?borrowed.value:0,ownerSupportCents:support.status==='available'?support.value:0,nondeductibleExpenseCents:sum([treatment.status==='available'?treatment.value.nondeductible:0,operating.status==='available'?sum(operating.value.nondeductible):0])}));
  if(operating.status==='available'&&sum(operating.value.capital)>0)extra=failure(project,year,'expenses.taxCategory','unsupported-adu-extra-recovery','Additional capital spending lacks an owned four-book recovery schedule.','unsupported-case');
  const facts=combine([preparedOpening,depreciation,treatment,operating,qualified,loanMechanical,extra,...contextComplete],()=>{
    if(preparedOpening.status!=='available'||depreciation.status!=='available'||treatment.status!=='available'||operating.status!=='available')throw new Error('Unavailable ADU tax operands.');
    const rentCents=sum(operating.value.rent),operatingExpenseCents=sum([sum(operating.value.deductible),treatment.value.current]);
    return {rentalId:unit.id,book,rentCents,operatingExpenseCents,eligibleInterestCents:treatment.value.interest,depreciationCents:depreciation.value.depreciationCents,taxableProfitCents:sum([rentCents,-operatingExpenseCents,-treatment.value.interest,-depreciation.value.depreciationCents]),openingState:preparedOpening.value,closingState:depreciation.value.closing};
  });
  return {capital,opening:preparedOpening,depreciation,facts,risk,eligibleInterest};
}
export function prepareAduTaxYear(plan:ValidatedPlan,context:AduYear,opening:HouseholdTaxState,rules:YearRules):PreparedAduTaxYear {
  const capitalClosing:Record<string,Readonly<Record<TaxBook,Available<AduCapitalBookState>>>>={...opening.aduProjects},rentals={...opening.rentals};
  const rentalFacts:RentalYearFacts[]=[],issues:Issue[]=[];
  for(const {property,project,rental:unit} of getAduProjects(plan)){
    if(!aduTaxActivityStarted(plan,property,rules.year))continue;
    const projectContext=context.projects.find(p=>p.projectId===project.id)!;
    const operating=operatingCash(plan,property,unit,rules.year);
    const resolved=Object.fromEntries(books.map(book=>{
      let result:BookPrepared;
      try{result=prepareBook(plan,project,unit,projectContext,book,opening,rules,operating);}catch(error){if(!(error instanceof CalculationRangeError))throw error;const missing=failure(project,rules.year,`aduProjects.${book}`,'monetary-overflow',error.message);result={capital:missing,opening:missing,depreciation:missing,facts:missing,risk:missing,eligibleInterest:missing};}
      return [book,result];
    })) as Record<TaxBook,BookPrepared>;
    capitalClosing[project.id]=Object.fromEntries(books.map(book=>[book,resolved[book].capital])) as Record<TaxBook,Available<AduCapitalBookState>>;
    rentals[unit.id]=Object.fromEntries(books.map(book=>[book,resolved[book].opening])) as Record<TaxBook,Available<RentalBookState>>;
    const loan=projectContext.loan,loanMonths=loan?.status==='available'?loan.value.months.filter(m=>m.date.startsWith(`${rules.year}-`)):[];
    const cashAmount=(field:RentalCashField,calculate:()=>Cents,operands:readonly Available<unknown>[]=[]):Available<Cents>=>{
      try{return combine(operands,calculate);}catch(error){if(!(error instanceof CalculationRangeError))throw error;return failure(project,rules.year,field,'monetary-overflow',error.message,'unsupported-case');}
    };
    const lifeAmount=(field:'constructionCostCents'|'projectTaxPaidCents'):Available<Cents>=>{
      const issues=projectContext.months.flatMap(m=>m.cashComplete.status==='available'?[]:m.cashComplete.issues.filter(i=>i.field===field));
      return cashAmount(field==='constructionCostCents'?'capitalExpenseCents':'cashFlowCents',()=>sum(projectContext.months.map(m=>m[field])),issues.length?[{status:'unsupported-case',issues}]:[]);
    };
    const loanGate=loan&&loan.status!=='available'&&projectContext.months.some(m=>m.financingProceedsCents>0||m.cashComplete.status!=='available'&&m.cashComplete.issues.some(i=>i.field==='aduProject.financing'))?[loan]:[];
    const normal=operating.status==='available'?operating.value:undefined;
    const rent=cashAmount('rentCents',()=>sum(normal?.rent??[]),[operating]);
    const expense=cashAmount('operatingExpenseCents',()=>sum(normal?.deductible??[]),[operating]);
    const capital=lifeAmount('constructionCostCents'),tax=lifeAmount('projectTaxPaidCents');
    const interest=cashAmount('cashInterestCents',()=>sum(loanMonths.map(m=>m.interestCents)),loanGate);
    const principal=cashAmount('principalPaidCents',()=>sum(loanMonths.map(m=>m.principalPaidCents)),loanGate);
    const debt=cashAmount('debtPaymentCents',()=>sum(loanMonths.map(m=>m.paymentCents)),loanGate);
    const value=(v:Available<Cents>):Cents=>v.status==='available'?v.value:0;
    const flow=cashAmount('cashFlowCents',()=>sum([value(rent),-sum(normal?.paid??[]),-value(tax),-value(capital),-value(debt)]),[operating,rent,tax,capital,debt,...projectContext.months.map(m=>m.cashComplete)]);
    const aduCash={rentCents:rent,operatingExpenseCents:expense,capitalExpenseCents:capital,debtPaymentCents:debt,cashInterestCents:interest,principalPaidCents:principal,cashFlowCents:flow};
    rentalFacts.push({rentalId:unit.id,propertyId:property.id,unit,financingAtRiskQualification:project.financing?.financingAtRiskQualification??{known:true,value:true},aduCash,rentCents:value(rent),operatingExpenseCents:value(expense),capitalExpenseCents:value(capital),debtPaymentCents:value(debt),cashInterestCents:value(interest),principalPaidCents:value(principal),cashFlowCents:value(flow),eligibleInterestCents:resolved.federal.eligibleInterest,
      depreciation:Object.fromEntries(books.map(book=>[book,resolved[book].depreciation])) as Record<TaxBook,Available<DepreciationYear>>,
      books:Object.fromEntries(books.map(book=>[book,resolved[book].facts])) as Record<TaxBook,Available<RentalTaxBookFacts>>,
      aduRiskMovements:Object.fromEntries(books.map(book=>[book,resolved[book].risk])) as Record<TaxBook,Available<AduRiskMovements>>,
    });
    for(const amount of Object.values(aduCash))if(amount.status!=='available')issues.push(...amount.issues);
    for(const book of books)for(const value of [resolved[book].capital,resolved[book].facts,resolved[book].risk])if(value.status!=='available')issues.push(...value.issues);
  }
  return {opening:{...opening,rentals},capitalClosing,rentalFacts,issues:[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()],provenance:context.projects.length?aduPlanningProvenance(rules.year):[]};
}
export function finishAduTaxYear(prepared:PreparedAduTaxYear,closing:HouseholdTaxState):HouseholdTaxState {
  return Object.keys(prepared.capitalClosing).length?{...closing,aduProjects:prepared.capitalClosing}:closing;
}
