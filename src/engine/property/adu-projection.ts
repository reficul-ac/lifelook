import type {Cents} from '../model/plan';
import type {Available,Issue} from '../model/results';
import type {AnnualProjection,MonthlyProjection,LoanProjection} from '../projection-types';
import type {AduProjectYear} from './adu-lifecycle';
import {CalculationRangeError,Decimal,settleCents} from '../money';
export interface AduProjectPeriodProjection {
 readonly projectId:string;readonly propertyId:string;readonly rentalId:string;
 readonly constructionCostCents:Available<Cents>;readonly financingProceedsCents:Available<Cents>;readonly financedCostPaidCents:Available<Cents>;
 readonly projectTaxPaidCents:Available<Cents>;readonly completionValueAddedCents:Available<Cents>;readonly earmarkedCashCents:Available<Cents>;
 readonly rentCents:Available<Cents>;readonly debtPaymentCents:Available<Cents>;readonly cashInterestCents:Available<Cents>;readonly principalPaidCents:Available<Cents>;
}
export interface AduPeriodProjection {
 readonly projects:readonly AduProjectPeriodProjection[];
 readonly constructionCostCents:Available<Cents>;readonly financingProceedsCents:Available<Cents>;readonly financedCostPaidCents:Available<Cents>;
 readonly projectTaxPaidCents:Available<Cents>;readonly completionValueAddedCents:Available<Cents>;readonly earmarkedCashCents:Available<Cents>;
 readonly unrestrictedCashCents:Available<Cents>;readonly allocationCashFlowCents:Available<Cents>;
}
export const aduAvailable=<T>(value:T):Available<T>=>({status:'available',value});
export function aduSum(values:readonly Available<Cents>[],field:string,year?:number):Available<Cents>{
 const absent=values.filter(v=>v.status!=='available');if(absent.length)return{status:absent.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:absent.flatMap(v=>v.issues)};
 try{return aduAvailable(settleCents(values.reduce((s,v)=>s.plus(v.status==='available'?v.value:0),new Decimal(0))));}
 catch(error){if(!(error instanceof CalculationRangeError))throw error;return{status:'unsupported-case',issues:[{code:'monetary-overflow',field,...(year?{year}:{}),severity:'error',explanation:'The affected ADU total exceeds the supported monetary range.',resolution:'Reduce the relevant amounts or horizon.'}]};}
}
export const aduNegative=(v:Available<Cents>):Available<Cents>=>v.status==='available'?aduAvailable(-v.value):v;
export function cashFlowBeforeInvestments(row:MonthlyProjection|AnnualProjection):Available<Cents>{
 const withholding=aduSum(row.accounts.flatMap(a=>a.withholdingCents?[a.withholdingCents]:[]),'rsuWithholdingCents',row.year);
 return aduSum([row.salaryCents,row.otherIncomeCents,row.rentCents,withholding,...[row.totalTaxCents,row.expensesCents,row.debtPaymentCents].map(aduNegative)],'cashFlowBeforeInvestmentsCents',row.year);
}
export function calculateFundingNeed(months:readonly MonthlyProjection[]):Available<Cents>{
 const amounts=months.map(m=>m.adu?.unrestrictedCashCents??m.reserveCents),absent=aduSum(amounts.map(v=>v.status==='available'?aduAvailable(0):v),'fundingNeedCents');
 return absent.status==='available'?aduAvailable(Math.max(0,...amounts.map(v=>v.status==='available'?-v.value:0))):absent;
}
/** A numeric lifecycle placeholder is never published without its field's availability. */
export function projectAduMonth(context:AduProjectYear,index:number,rent:Available<Cents>,loan:LoanProjection|undefined):AduProjectPeriodProjection {
 const m=context.months[index]!;
 const money=(field:'constructionCostCents'|'financingProceedsCents'|'financedCostPaidCents'|'projectTaxPaidCents'|'earmarkedCashCents'):Available<Cents>=>{
  const issues:readonly Issue[]=m.cashComplete.status==='available'?[]:m.cashComplete.issues.filter(i=>i.field===field);
  return issues.length?{status:'unsupported-case',issues}:aduAvailable(m[field]);
 };
 return {projectId:context.projectId,propertyId:context.propertyId,rentalId:context.rentalId,constructionCostCents:money('constructionCostCents'),financingProceedsCents:money('financingProceedsCents'),financedCostPaidCents:money('financedCostPaidCents'),projectTaxPaidCents:money('projectTaxPaidCents'),completionValueAddedCents:m.completionValueAddedCents,earmarkedCashCents:money('earmarkedCashCents'),rentCents:rent,debtPaymentCents:loan?.paymentCents??aduAvailable(0),cashInterestCents:loan?.interestCents??aduAvailable(0),principalPaidCents:loan?.principalPaidCents??aduAvailable(0)};
}
const flows=['constructionCostCents','financingProceedsCents','financedCostPaidCents','projectTaxPaidCents','completionValueAddedCents'] as const;
export function combineAduMonth(projects:readonly AduProjectPeriodProjection[],reserve:Available<Cents>,a:Available<Cents>,year:number):AduPeriodProjection {
 const totals=Object.fromEntries([...flows,'earmarkedCashCents' as const].map(field=>[field,aduSum(projects.map(p=>p[field]),field,year)])) as Pick<AduPeriodProjection,typeof flows[number]|'earmarkedCashCents'>;
 return{projects,...totals,unrestrictedCashCents:aduSum([reserve,aduNegative(totals.earmarkedCashCents)],'unrestrictedCashCents',year),allocationCashFlowCents:aduSum([a,totals.financedCostPaidCents],'allocationCashFlowCents',year)};
}
export function summarizeAduPeriods(rows:readonly AduPeriodProjection[],year:number):AduPeriodProjection {
 const last=rows.at(-1)!;
 const projects=last.projects.map(project=>{const series=rows.map(r=>r.projects.find(p=>p.projectId===project.projectId)!);return{...project,...Object.fromEntries([...flows,'rentCents','debtPaymentCents','cashInterestCents','principalPaidCents'].map(field=>[field,aduSum(series.map(p=>p[field as keyof typeof project] as Available<Cents>),field,year)]))};});
 return{...last,projects,...Object.fromEntries([...flows,'allocationCashFlowCents'].map(field=>[field,aduSum(rows.map(r=>r[field as keyof AduPeriodProjection] as Available<Cents>),field,year)]))};
}
