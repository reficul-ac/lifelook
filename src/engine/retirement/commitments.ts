import type {ValidatedPlan} from '../model/plan';
import type {ValidatedRetirementAnalysis} from './definition';
import {aduActivityStartDate} from '../property/adu-lifecycle';
export interface RetirementCommitmentDecision {readonly recordId:string;readonly action:'continue'|'exclude';readonly started:boolean;readonly explanation:string}
export function resolveRetirementCommitments(source:ValidatedPlan,definition:ValidatedRetirementAnalysis,year:number):readonly RetirementCommitmentDecision[]{
 const date=`${year}-01-01`,decisions:RetirementCommitmentDecision[]=[];
 for(const property of source.properties){
  if(property.purchaseDate>`${source.startYear}-01-01`&&property.purchaseDate>=date){const choice=definition.commitments.find(c=>c.recordId===property.id);decisions.push({recordId:property.id,action:choice?.action??(definition.mode==='projected'?'continue':'exclude'),started:false,explanation:choice?'Explicit retirement commitment choice.':definition.mode==='projected'?'Projected scheduled purchase continues.':'Unstarted purchase excluded from the target end-configuration.'});}
  if(property.aduProject){const id=property.aduProject.id,started=aduActivityStartDate(source,property)<date,complete=property.aduProject.completionDate<date;if(complete)continue;const choice=definition.commitments.find(c=>c.recordId===id);decisions.push({recordId:id,started,action:started?'continue':choice?.action??(definition.mode==='projected'?'continue':'exclude'),explanation:started?'In-progress project and committed funding continue.':choice?'Explicit retirement commitment choice.':definition.mode==='projected'?'Projected scheduled project continues.':'Unstarted project excluded from the target end-configuration.'});}
 }
 return decisions;
}
