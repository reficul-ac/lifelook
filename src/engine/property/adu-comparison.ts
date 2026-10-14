import type {Cents,ISODate,ValidatedPlan,YearMonth} from '../model/plan';
import type {Available,Issue,RuleProvenance,ValidationResult} from '../model/results';
import type {RuleSet} from '../rules/types';
import type {AnnualProjection,MonthlyProjection,ProjectionResult} from '../projection-types';
import {calculateProjection} from '../projection';
import {validatePlan} from '../validation';
import {Decimal} from '../money';
import {getAduProjects} from './adu-ownership';
import {aduAvailable,aduSum,aduNegative,cashFlowBeforeInvestments,calculateFundingNeed} from './adu-projection';
export interface AduComparisonPeriod {
 readonly year:number;readonly month?:number;
 readonly constructionCostCents:Available<Cents>;readonly financingProceedsCents:Available<Cents>;readonly rentCents:Available<Cents>;
 readonly expensesCents:Available<Cents>;readonly debtPaymentCents:Available<Cents>;readonly cashFlowBeforeInvestmentsCents:Available<Cents>;
 readonly totalTaxCents:Available<Cents>;readonly investmentContributionsCents:Available<Cents>;readonly reserveCents:Available<Cents>;
 readonly propertyEquityCents:Available<Cents>;readonly netWorthCents:Available<Cents>;
 readonly cashOnCash?:Available<number>;readonly partialReturnYear?:boolean;
}
export interface AduBuildComparison {
 readonly projectId:string;readonly propertyId:string;readonly rentalId:string;readonly build:ProjectionResult;readonly noBuild:ProjectionResult;
 readonly months:readonly AduComparisonPeriod[];readonly years:readonly AduComparisonPeriod[];readonly issues:readonly Issue[];readonly provenance:readonly RuleProvenance[];
 readonly ownerCommitmentCents:Available<Cents>;readonly payback:Available<{kind:'reached';month:YearMonth}|{kind:'not-reached'}|{kind:'no-positive-capital'}>;
 readonly buildFundingNeedCents:Available<Cents>;readonly noBuildFundingNeedCents:Available<Cents>;
}
function issue(code:string,explanation:string,recordId?:string):Issue{return{code,...(recordId?{recordId}:{}),field:'aduComparison',severity:'warning',explanation,resolution:'Select an owned project and resolve the required calculated cash inputs within the forecast.'};}
export function createAduNoBuildPlan(plan:ValidatedPlan,projectId:string):ValidationResult {
 const owner=getAduProjects(plan).find(p=>p.project.id===projectId);if(!owner)return{ok:false,issues:[issue('required-adu-project','The selected project is absent from this applied scenario.',projectId)]};
 const properties=plan.properties.map(property=>{if(property.id!==owner.property.id)return property;const{aduProject,...home}=property;return{...home,role:'primary' as const};});
 return validatePlan({...plan,properties,rentals:plan.rentals.filter(r=>r.id!==owner.rental.id),expenses:plan.expenses.filter(e=>e.rentalId!==owner.rental.id)});
}
export function calculateAduCashReturns(months:readonly {date:YearMonth;cashFlowDeltaCents:Available<Cents>;financingProceedsCents:Available<Cents>}[],completionDate:ISODate):{
 ownerCommitmentCents:Available<Cents>;payback:AduBuildComparison['payback'];annualReturns:readonly {year:number;cashOnCash:Available<number>;partialReturnYear:boolean}[];
} {
 const ordered=[...months].sort((a,b)=>a.date.localeCompare(b.date)),completion=completionDate.slice(0,7),years=[...new Set(ordered.map(m=>Number(m.date.slice(0,4))))];
 const before=ordered.filter(m=>m.date<=completion),after=ordered.filter(m=>m.date>completion);
 const outside:Available<never>={status:'needs-data',issues:[issue('adu-completion-outside-forecast','Completion lies outside the calculated cash horizon.')]};
 const ownerCommitmentCents=ordered.length>0&&ordered[0]!.date<=completion&&ordered.at(-1)!.date>=completion&&ordered.some(m=>m.date===completion)?aduNegative(aduSum(before.flatMap(m=>[m.cashFlowDeltaCents,m.financingProceedsCents]),'ownerCommitmentCents')):outside;
 let payback:AduBuildComparison['payback'];
 if(ownerCommitmentCents.status!=='available')payback=ownerCommitmentCents;
 else if(ownerCommitmentCents.value<=0)payback=aduAvailable({kind:'no-positive-capital'});
 else {
  payback=aduAvailable({kind:'not-reached'});let recovery:Available<Cents>=aduAvailable(0);
  for(const row of after){recovery=aduSum([recovery,row.cashFlowDeltaCents],'paybackCents');if(recovery.status!=='available'){payback=recovery;break;}if(recovery.value>=ownerCommitmentCents.value){payback=aduAvailable({kind:'reached',month:row.date});break;}}
 }
 const undefinedRatio:Available<never>={status:'needs-data',issues:[issue('adu-no-positive-owner-capital','There is no positive owner capital to recover; the return ratio is undefined.')]};
 const annualReturns=years.map(year=>{
  const operating=after.filter(m=>m.date.startsWith(`${year}-`)),cash=aduSum(operating.map(m=>m.cashFlowDeltaCents),'annualCashReturnCents',year);
  const cashOnCash:Available<number>=ownerCommitmentCents.status!=='available'?ownerCommitmentCents:ownerCommitmentCents.value<=0?undefinedRatio:cash.status!=='available'?cash:aduAvailable(new Decimal(cash.value).div(ownerCommitmentCents.value).toNumber());
  return{year,cashOnCash,partialReturnYear:operating.length>0&&operating.length<12};
 });
 return{ownerCommitmentCents,payback,annualReturns};
}
const difference=(build:Available<Cents>,noBuild:Available<Cents>,field:string,year:number):Available<Cents>=>aduSum([build,aduNegative(noBuild)],field,year);
function comparePeriod(build:MonthlyProjection|AnnualProjection,noBuild:MonthlyProjection|AnnualProjection):AduComparisonPeriod {
 const year=build.year;
 const d=(a:Available<Cents>,b:Available<Cents>,field:string)=>difference(a,b,field,year);
 const amounts=Object.fromEntries((['rentCents','expensesCents','debtPaymentCents','totalTaxCents','reserveCents','netWorthCents'] as const).map(field=>[field,d(build[field],noBuild[field],field)])) as Pick<AduComparisonPeriod,'rentCents'|'expensesCents'|'debtPaymentCents'|'totalTaxCents'|'reserveCents'|'netWorthCents'>;
 return {year,...('month' in build?{month:build.month}:{}),...amounts,
  constructionCostCents:d(build.adu?.constructionCostCents??aduAvailable(0),noBuild.adu?.constructionCostCents??aduAvailable(0),'constructionCostCents'),
  financingProceedsCents:d(build.adu?.financingProceedsCents??aduAvailable(0),noBuild.adu?.financingProceedsCents??aduAvailable(0),'financingProceedsCents'),
  cashFlowBeforeInvestmentsCents:d(cashFlowBeforeInvestments(build),cashFlowBeforeInvestments(noBuild),'cashFlowBeforeInvestmentsCents'),
  investmentContributionsCents:d(build.eligibleContributionCents,noBuild.eligibleContributionCents,'investmentContributionsCents'),propertyEquityCents:d(build.equityCents,noBuild.equityCents,'propertyEquityCents')};
}
/** Both forecasts own their complete carried state and policy solve; drafts cannot enter here. */
export function calculateAduBuildComparison(plan:ValidatedPlan,rules:RuleSet,projectId:string):Available<AduBuildComparison> {
 const owner=getAduProjects(plan).find(p=>p.project.id===projectId),derived=createAduNoBuildPlan(plan,projectId);
 if(!owner||!derived.ok)return{status:'needs-data',issues:derived.issues};
 const build=calculateProjection(plan,rules),noBuild=calculateProjection(derived.plan,rules);
 const months=build.months.map((row,i)=>comparePeriod(row,noBuild.months[i]!));
 const returns=calculateAduCashReturns(months.map((m,i)=>({date:build.months[i]!.date,cashFlowDeltaCents:m.cashFlowBeforeInvestmentsCents,financingProceedsCents:build.months[i]!.adu!.projects.find(p=>p.projectId===projectId)!.financingProceedsCents})),owner.project.completionDate);
 const years=build.years.map((row,i)=>({...comparePeriod(row,noBuild.years[i]!),...returns.annualReturns.find(y=>y.year===row.year)!}));
 const buildFundingNeedCents=calculateFundingNeed(build.months),noBuildFundingNeedCents=calculateFundingNeed(noBuild.months);
 const fields:readonly Available<unknown>[]=[returns.ownerCommitmentCents,returns.payback,buildFundingNeedCents,noBuildFundingNeedCents,...months.flatMap(m=>Object.values(m).filter((v):v is Available<number>=>typeof v==='object')),...years.flatMap(m=>Object.values(m).filter((v):v is Available<number>=>typeof v==='object'))];
 const issues=[...new Map([...build.issues,...noBuild.issues,...fields.flatMap(f=>f.status==='available'?[]:f.issues)].map(i=>[JSON.stringify(i),i])).values()];
 const provenance=[...new Map([...build.provenance,...noBuild.provenance].map(p=>[JSON.stringify(p),p])).values()];
 return aduAvailable({projectId,propertyId:owner.property.id,rentalId:owner.rental.id,build,noBuild,months,years,ownerCommitmentCents:returns.ownerCommitmentCents,payback:returns.payback,buildFundingNeedCents,noBuildFundingNeedCents,issues,provenance});
}
