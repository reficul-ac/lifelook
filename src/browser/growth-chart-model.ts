import type {Available,Cents,Issue} from '../engine';
import {CalculationRangeError,Decimal,settleCents} from '../engine/money';
import type {ReportSnapshot} from './report-snapshot';

export type GrowthChartHorizon=5|10|15|'all';
export interface GrowthChartViewState {horizon:GrowthChartHorizon;showComparison:boolean}
export interface GrowthChartPoint {
 readonly year:number;
 readonly netWorth:Available<Cents>;
 readonly appliedNetWorth:Available<Cents>|null;
 readonly delta:Available<Cents>|null;
}
export interface GrowthChartModel {
 readonly points:readonly GrowthChartPoint[];
 readonly selectedYear:number;
 readonly horizon:GrowthChartHorizon;
 readonly availableHorizons:readonly GrowthChartHorizon[];
 readonly status:ReportSnapshot['status'];
 readonly sourceLabel:string;
 readonly canCompare:boolean;
}

function difference(candidate:Available<Cents>,applied:Available<Cents>,year:number):Available<Cents> {
 if(candidate.status!=='available'||applied.status!=='available'){
  const unavailable=[candidate,applied].filter(value=>value.status!=='available');
  return {status:unavailable.some(value=>value.status==='unsupported-case')?'unsupported-case':'needs-data',issues:[...new Map(unavailable.flatMap(value=>value.issues).map(issue=>[JSON.stringify(issue),issue])).values()]};
 }
 try{return {status:'available',value:settleCents(new Decimal(candidate.value).minus(applied.value))};}
 catch(error){
  if(!(error instanceof CalculationRangeError))throw error;
  const issue:Issue={code:'monetary-overflow',year,field:'growthChart.delta.netWorthCents',severity:'error',explanation:'This change exceeds the supported monetary range.',resolution:'Reduce the affected amounts or growth assumptions before comparing this amount.'};
  return {status:'unsupported-case',issues:[issue]};
 }
}

/** Uses only the annual results and plan that produced this report. */
export function buildGrowthChartModel(snapshot:ReportSnapshot,selectedYear:number,horizon:GrowthChartHorizon):GrowthChartModel {
 const {startYear,horizonYears}=snapshot.plan;
 const years=snapshot.projection.years.filter(row=>row.year>=startYear&&row.year<startYear+horizonYears);
 const availableHorizons:GrowthChartHorizon[]=[...([5,10,15] as const).filter(length=>length<horizonYears),'all'];
 const normalized=availableHorizons.includes(horizon)?horizon:'all';
 const visible=years.filter(row=>normalized==='all'||row.year<startYear+normalized);
 const canCompare=snapshot.status==='preview'&&snapshot.allowDeltas&&snapshot.comparison!==null;
 const appliedYears=new Map(canCompare?snapshot.comparison!.projection.years.map(row=>[row.year,row]):[]);
 const points=visible.map(row=>{
  const appliedNetWorth=appliedYears.get(row.year)?.netWorthCents??null;
  return {year:row.year,netWorth:row.netWorthCents,appliedNetWorth,delta:appliedNetWorth?difference(row.netWorthCents,appliedNetWorth,row.year):null};
 });
 const nearest=Number.isFinite(selectedYear)?points.reduce<number|undefined>((best,point)=>best===undefined||Math.abs(point.year-selectedYear)<Math.abs(best-selectedYear)?point.year:best,undefined):points[points.length-1]?.year;
 return {points,selectedYear:nearest??startYear,horizon:normalized,availableHorizons,status:snapshot.status,sourceLabel:snapshot.label,canCompare};
}
