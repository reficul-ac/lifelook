import {calendarDate} from '../dates';
import {CalculationRangeError,Decimal,settleCents} from '../money';
import type {AduProject,Cents,Property,ValidatedPlan} from '../model/plan';
import type {Available,Issue,RuleProvenance} from '../model/results';
import {aduPlanningProvenance} from '../rules/adu-planning-v1';
import {getAduProjects} from './adu-ownership';
import {calculateAduValueAdded} from './adu-valuation';
import {calculateAduLoanSchedule,resolveAduFunding} from './adu-loans';
import type {AduLoanSchedule} from './adu-loans';
export interface AduLifecycleMonth {
  readonly year:number;readonly month:number;readonly constructionCostCents:Cents;readonly financingProceedsCents:Cents;
  readonly financedCostPaidCents:Cents;readonly ownerConstructionCents:Cents;readonly projectTaxPaidCents:Cents;
  readonly completionValueAddedCents:Available<Cents>;readonly earmarkedCashCents:Cents;readonly marketValueComplete:boolean;
  readonly cashComplete:Available<true>;
}
export interface AduProjectYear {
  readonly propertyId:string;readonly projectId:string;readonly rentalId:string;readonly months:readonly AduLifecycleMonth[];
  readonly loan?:Available<AduLoanSchedule>;readonly issues:readonly Issue[];readonly provenance:readonly RuleProvenance[];
}
export interface AduYear {readonly year:number;readonly projects:readonly AduProjectYear[];readonly cashComplete:Available<true>}
const available=<T>(value:T):Available<T>=>({status:'available',value});
function completeness(results:readonly Available<true>[]):Available<true> {
  const failures=results.filter(r=>r.status!=='available');
  return failures.length?{status:failures.some(r=>r.status==='unsupported-case')?'unsupported-case':'needs-data',issues:failures.flatMap(r=>r.issues)}:available(true);
}
/** Earliest relevant event, shared by cash coverage and later pending-tax activation. */
export function aduActivityStartDate(plan:ValidatedPlan,property:Property):string {
  const project=property.aduProject!;
  return [project.constructionStartDate,...project.costs.filter(c=>c.amountCents>0).map(c=>c.paymentDate),
    ...(project.financing?.draws.filter(d=>d.amountCents>0).map(d=>`${d.month}-01`)??[]),
    ...project.propertyTax.paymentYears.flatMap(y=>y.payments.filter(p=>p.amountCents>0).map(p=>`${p.month}-01`)),
    ...plan.expenses.filter(e=>e.rentalId===project.rentalId&&e.amountCents>0).map(e=>e.startDate),
  ].sort()[0]!;
}
function issue(project:AduProject,year:number,code:string,field:string,explanation:string):Issue {
  return {code,recordId:project.id,year,field,severity:'warning',explanation,resolution:'Confirm the complete incremental paid-tax schedule and original-property-only bill, or correct the affected amount.'};
}
export function resolveAduYear(plan:ValidatedPlan,year:number):AduYear {
  const projects:AduProjectYear[]=getAduProjects(plan).map(({property,project,rental})=>{
    const prefix=year-plan.startYear+1,funding=resolveAduFunding(property,plan.startYear,prefix);
    const loan=project.financing?calculateAduLoanSchedule(property,plan.startYear,prefix):undefined;
    const activity=aduActivityStartDate(plan,property),taxYear=project.propertyTax.paymentYears.find(row=>row.year===year);
    const value=calculateAduValueAdded(property),completionMonth=project.completionDate.slice(0,7);
    const wipStart=[project.constructionStartDate,...project.costs.filter(c=>c.amountCents>0).map(c=>c.paymentDate)].sort()[0]!;
    const costById=new Map(project.costs.map(c=>[c.id,c]));
    const yearIssues:Issue[]=[];
    const months:AduLifecycleMonth[]=Array.from({length:12},(_,index)=>{
      const month=index+1,end=calendarDate(year,month,31),key=end.slice(0,7),issues:Issue[]=[];
      const money=(field:string,exact:Decimal):Cents=>{try{return settleCents(exact);}catch(error){if(!(error instanceof CalculationRangeError))throw error;issues.push(issue(project,year,'monetary-overflow',field,error.message));return 0;}};
      const total=(values:readonly Cents[]):Decimal=>values.reduce((sum,v)=>sum.plus(v),new Decimal(0));
      const costs=total(project.costs.filter(c=>c.paymentDate.slice(0,7)===key).map(c=>c.amountCents));
      const constructionCostCents=money('constructionCostCents',costs);
      const f=funding.status==='available'?funding.value[(year-plan.startYear)*12+index]:undefined;
      // A failed aggregate must not erase independently known draw/cost records.
      const draws=project.financing?.draws??[];
      const financingProceedsCents=f?.drawCents??money('financingProceedsCents',total(draws.filter(d=>d.month===key).map(d=>d.amountCents)));
      const financedExact=total(draws.flatMap(d=>d.costAllocations.filter(a=>costById.get(a.costId)!.paymentDate.slice(0,7)===key).map(a=>a.amountCents)));
      const financedCostPaidCents=f?.financedCostPaidCents??money('financedCostPaidCents',financedExact);
      const ownerConstructionCents=f?.ownerConstructionCents??money('ownerConstructionCents',costs.minus(financedExact));
      const earmarkedCashCents=f?.closingEarmarkedCents??money('earmarkedCashCents',total(draws.filter(d=>d.month<=key).flatMap(d=>d.costAllocations.filter(a=>costById.get(a.costId)!.paymentDate.slice(0,7)>key).map(a=>a.amountCents))));
      const projectTaxPaidCents=money('projectTaxPaidCents',total((taxYear?.payments??[]).filter(p=>p.month===key).map(p=>p.amountCents)));
      let unsupported=false;
      if(end>=activity){
        if(!taxYear?.complete.known||!taxYear.complete.value)issues.push(issue(project,year,'required-adu-tax-payments','propertyTax.paymentYears','The incremental paid-tax schedule has not been confirmed complete for this year, including a known-zero answer.'));
        const excludes=project.propertyTax.originalExpenseExcludesAdu;
        if(!excludes.known||!excludes.value){unsupported=excludes.known;issues.push(issue(project,year,excludes.known?'overlapping-adu-property-tax':'required-adu-original-tax-scope','propertyTax.originalExpenseExcludesAdu','Confirm that original-property tax expenses exclude the incremental ADU payments.'));}
      }
      const firstDraw=draws.filter(d=>d.amountCents>0).map(d=>d.month).sort()[0];
      if(loan&&loan.status!=='available'&&firstDraw&&key>=firstDraw){issues.push(...loan.issues);unsupported||=loan.status==='unsupported-case';}
      const cashComplete:Available<true>=issues.length?{status:unsupported?'unsupported-case':'needs-data',issues}:available(true);
      const completionValueAddedCents=key===completionMonth?value:available(0);
      if(completionValueAddedCents.status!=='available')yearIssues.push(...completionValueAddedCents.issues);
      yearIssues.push(...issues);
      return {year,month,constructionCostCents,financingProceedsCents,financedCostPaidCents,ownerConstructionCents,projectTaxPaidCents,completionValueAddedCents,earmarkedCashCents,marketValueComplete:end<wipStart||key>=completionMonth,cashComplete};
    });
    return {propertyId:property.id,projectId:project.id,rentalId:rental.id,months,...(loan?{loan}:{}),issues:yearIssues,provenance:aduPlanningProvenance(year)};
  });
  return {year,projects,cashComplete:completeness(projects.flatMap(p=>p.months.map(m=>m.cashComplete)))};
}
