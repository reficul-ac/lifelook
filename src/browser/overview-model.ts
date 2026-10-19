import type {AnnualProjection,Available,Cents,Issue} from '../engine';
import {CalculationRangeError,Decimal,settleCents} from '../engine/money';
import {projectionSummary,type ProjectionSummaryRow} from './projection-summary';
import type {ReportSnapshot} from './report-snapshot';

export type BalanceSheetRow=Pick<AnnualProjection,'year'|'reserveCents'|'accountBalanceCents'|'propertyValueCents'|'loanBalanceCents'|'netWorthCents'>;
export type OverviewMetric=Exclude<keyof BalanceSheetRow,'year'>|'cashFlowCents';
export interface OverviewRow {
 readonly balance:BalanceSheetRow;
 readonly financial:ProjectionSummaryRow;
 readonly deltas:Readonly<Record<OverviewMetric,Available<Cents>|null>>;
 readonly noComparison:boolean;
}
const metrics:readonly OverviewMetric[]=['reserveCents','accountBalanceCents','propertyValueCents','loanBalanceCents','netWorthCents','cashFlowCents'];
function subtract(candidate:Available<Cents>,base:Available<Cents>,year:number,field:OverviewMetric):Available<Cents> {
 if(candidate.status!=='available'||base.status!=='available'){
  const unavailable=[candidate,base].filter(value=>value.status!=='available');
  return {status:unavailable.some(value=>value.status==='unsupported-case')?'unsupported-case':'needs-data',issues:[...new Map(unavailable.flatMap(value=>value.issues).map(issue=>[JSON.stringify(issue),issue])).values()]};
 }
 try{return {status:'available',value:settleCents(new Decimal(candidate.value).minus(base.value))};}
 catch(error){
  if(!(error instanceof CalculationRangeError))throw error;
  const issue:Issue={code:'monetary-overflow',year,field:`overview.delta.${field}`,severity:'error',explanation:'This change exceeds the supported monetary range.',resolution:'Reduce the affected amounts or growth assumptions before comparing this amount.'};
  return {status:'unsupported-case',issues:[issue]};
 }
}
export function buildOverviewRows(snapshot:ReportSnapshot):readonly OverviewRow[] {
 const baseYears=new Map(snapshot.comparison?.projection.years.map(year=>[year.year,year]));
 return snapshot.projection.years.map(year=>{
  const {reserveCents,accountBalanceCents,propertyValueCents,loanBalanceCents,netWorthCents}=year;
  const balance:BalanceSheetRow={year:year.year,reserveCents,accountBalanceCents,propertyValueCents,loanBalanceCents,netWorthCents},financial=projectionSummary(year),base=baseYears.get(year.year),baseSummary=base?projectionSummary(base):null;
  const deltas=Object.fromEntries(metrics.map(key=>[key,snapshot.allowDeltas&&base&&baseSummary?subtract(key==='cashFlowCents'?financial[key]:balance[key],key==='cashFlowCents'?baseSummary[key]:base[key],year.year,key):null])) as Record<OverviewMetric,Available<Cents>|null>;
  return {balance,financial,deltas,noComparison:snapshot.allowDeltas&&snapshot.comparison!==null&&!base};
 });
}
