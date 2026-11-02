import type {ForecastContext,ForecastCheckpoint,ForecastYearPolicy} from '../forecast/types';
import type {ValidatedPlan} from '../model/plan';
import type {Available,Issue} from '../model/results';
import {validatePlan} from '../validation';
import {resolveAduPlanningEstimates} from '../property/adu-planning-estimates';
import type {ValidatedRetirementCalendar} from './calendar';
import type {ValidatedRetirementAnalysis} from './definition';
import {resolveRetirementAssumptions,type ResolvedRetirementAssumptions} from './assumptions';
import {resolveRetirementCommitments,type RetirementCommitmentDecision} from './commitments';
export interface RetirementSnapshot {
 readonly context:ForecastContext;readonly opening:ForecastCheckpoint;readonly definition:ValidatedRetirementAnalysis;readonly calendar:ValidatedRetirementCalendar;readonly assumptions:ResolvedRetirementAssumptions;readonly retirementYear:number;readonly endYear:2100;
 readonly commitments:readonly RetirementCommitmentDecision[];readonly propertyStatuses:readonly {readonly propertyId:string;readonly status:'owned'|'pending'}[];readonly issues:readonly Issue[];
}
export function createRetirementSnapshot(context:ForecastContext,opening:ForecastCheckpoint,definition:ValidatedRetirementAnalysis,calendar:ValidatedRetirementCalendar):Available<RetirementSnapshot>{
 const issues:Issue[]=[];
 if(opening.sourceBinding!==context.sourceBinding||opening.ruleBinding!==context.ruleBinding||opening.year!==calendar.startYear||calendar.endYear!==2100)throw new RangeError('Retirement snapshot binding mismatch.');
 const date=`${calendar.startYear}-01-01`,commitments=resolveRetirementCommitments(context.source,definition,calendar.startYear);
 for(const owner of context.source.household.filers)if(!owner.birthDate.known&&!definition.assumptions.owners.find(o=>o.ownerId===owner.id)?.birthDate?.known)issues.push({code:'required-retirement-age',recordId:owner.id,field:'birthDate',severity:'warning',explanation:'Retirement tax and distribution calculations require an entered or explicit estimated birth date.',resolution:'Enter the historical birth date or a retirement-only date assumption.'});
 if(issues.length)return {status:'needs-data',issues};
 if(definition.mode==='reallocate')for(const choice of definition.existingProperties.filter(c=>c.action==='sell')){
  const property=context.plan.properties.find(p=>p.id===choice.propertyId)!,project=property.aduProject;
  if(project&&commitments.some(c=>c.recordId===project.id&&c.started)&&project.completionDate>=date)issues.push({code:'unsettled-retirement-project',recordId:project.id,field:'existingProperties',severity:'warning',explanation:'Selling this in-progress host requires an as-is value and settlement of committed work and drawn debt.',resolution:'Keep the host or provide a separately supported project settlement.'});
 }
 if(issues.length)return {status:'unsupported-case',issues};
 return {status:'available',value:{context,opening,definition,calendar,assumptions:resolveRetirementAssumptions(context.source,definition),retirementYear:calendar.startYear,endYear:2100,commitments,propertyStatuses:context.source.properties.map(p=>({propertyId:p.id,status:p.purchaseDate<date||p.purchaseDate===date&&calendar.startYear===context.source.startYear?'owned':'pending'})),issues:opening.sourceIssues}};
}
export function compileRetirementYearPolicy(snapshot:RetirementSnapshot,year:number):ForecastYearPolicy{
 if(!Number.isInteger(year)||year<snapshot.retirementYear||year>snapshot.endYear)throw new RangeError('Year is outside the retirement calendar.');
 const source=snapshot.context.plan,excluded=new Set(snapshot.commitments.filter(c=>c.action==='exclude').map(c=>c.recordId));
 const removedRentals=new Set(source.rentals.filter(r=>excluded.has(r.propertyId)||source.properties.some(p=>p.aduProject?.rentalId===r.id&&excluded.has(p.aduProject.id))).map(r=>r.id));
 const properties=source.properties.filter(p=>!excluded.has(p.id)).map(p=>{if(!p.aduProject||!excluded.has(p.aduProject.id))return p;const {aduProject:_,...property}=p;return {...property,role:'primary' as const};});
 const {retirementAnalysis:_,cashFlowAllocation:__,...original}=source;
 const filers=source.household.filers.map(f=>{const override=snapshot.definition.assumptions.owners.find(o=>o.ownerId===f.id)?.birthDate;return f.birthDate.known||!override?.known?f:{...f,birthDate:override};}) as unknown as typeof source.household.filers;
 const validation=validatePlan({...original,household:{...source.household,filers},salaries:[],otherIncome:source.otherIncome.filter(i=>i.classification!=='wage'),contributions:[],properties,rentals:source.rentals.filter(r=>!removedRentals.has(r.id)),expenses:source.expenses.filter(e=>!excluded.has(e.propertyId??'')&&!removedRentals.has(e.rentalId??'')),debts:source.debts.filter(d=>!excluded.has(d.propertyId??''))});
 if(!validation.ok)throw new Error(`Invalid retirement inventory: ${JSON.stringify(validation.issues)}`);
 const plan:ValidatedPlan=resolveAduPlanningEstimates(validation.plan,{year,calendar:snapshot.calendar});
 return {kind:'retired',year,plan,calendar:snapshot.calendar,employmentEndDate:`${snapshot.retirementYear}-01-01`,inheritedIssues:snapshot.issues};
}
