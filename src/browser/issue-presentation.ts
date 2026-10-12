import type {Issue,PlanDocument} from '../engine';
import type {DisclosureController} from './disclosures';
import type {WorkspaceState} from './state';
export type ReportPeriod=Readonly<{year:number;month?:number}>;
export type IssueOccurrence=Readonly<{issue:Issue;period?:ReportPeriod}>;
export type IssueGroup=Readonly<{key:string;issues:readonly Issue[];periods:readonly ReportPeriod[]}>;
export type InputSection='Household'|'Income'|'Expenses and debts'|'Investments'|'Properties';
export type ReviewTarget=Readonly<{section:InputSection;recordId:string;field?:string;label:string}>;
export interface IssueViewContext {readonly disclosures:DisclosureController;readonly readState:()=>Pick<WorkspaceState,'savedPlan'|'drafts'>;readonly review:(target:ReviewTarget)=>void}
export type AmountScope=Readonly<{label:string;period?:ReportPeriod}>;
export function groupIssueOccurrences(items:readonly IssueOccurrence[]):readonly IssueGroup[]{
  const groups=new Map<string,{key:string;issues:Issue[];periods:ReportPeriod[]}>();
  for(const {issue,period} of items){
    const key=JSON.stringify([issue.code,issue.recordId,issue.field,issue.severity,issue.explanation,issue.resolution]);
    let group=groups.get(key);if(!group){group={key,issues:[],periods:[]};groups.set(key,group);}
    if(!group.issues.some(existing=>JSON.stringify(existing)===JSON.stringify(issue)))group.issues.push(issue);
    const original=issue.year!==undefined?{year:issue.year,...(period?.year===issue.year&&period.month!==undefined?{month:period.month}:{})}:period;
    if(original&&!group.periods.some(p=>p.year===original.year&&p.month===original.month))group.periods.push(original);
  }
  for(const group of groups.values())group.periods.sort((a,b)=>a.year-b.year||(a.month??0)-(b.month??0));
  return [...groups.values()];
}
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function formatPeriods(periods:readonly ReportPeriod[]):string{
  const sorted=[...new Map(periods.map(p=>[`${p.year}:${p.month??0}`,p])).values()].sort((a,b)=>a.year-b.year||(a.month??0)-(b.month??0));
  const text:string[]=[];
  for(let i=0;i<sorted.length;i++){
    const start=sorted[i]!;let end=start;
    while(i+1<sorted.length){const next=sorted[i+1]!;if(start.month===undefined?next.month===undefined&&next.year===end.year+1:next.month!==undefined&&next.year*12+next.month===end.year*12+end.month!+1){end=next;i++;}else break;}
    if(start.month===undefined)text.push(start.year===end.year?String(start.year):`${start.year}–${end.year}`);
    else if(start===end)text.push(`${months[start.month-1]} ${start.year}`);
    else text.push(start.year===end.year?`${months[start.month-1]}–${months[end.month!-1]} ${start.year}`:`${months[start.month-1]} ${start.year}–${months[end.month!-1]} ${end.year}`);
  }return text.join(', ');
}
export const normalizeFieldPath=(path:string):string=>path.replace(/\[(\d+)\]/g,'.$1');
export function findRecordPath(value:unknown,id:string,path=''):string|undefined{
  if(!value||typeof value!=='object')return undefined;
  if('id' in value&&value.id===id)return path;
  for(const [key,child] of Object.entries(value)){const found=findRecordPath(child,id,path?`${path}.${key}`:key);if(found!==undefined)return found;}return undefined;
}
export function getRecordLabel(plan:PlanDocument,id:string):string{
  if(id===plan.id||id==='household')return 'Household';
  for(const record of [...plan.household.filers,...plan.salaries,...plan.otherIncome,...plan.expenses,...plan.debts,...plan.accounts,...plan.properties,...plan.properties.flatMap(p=>p.loans)])if(record.id===id)return record.name;
  for(const account of plan.accounts)for(const grant of account.rsu?.grants??[])if(grant.id===id)return grant.name;
  const rental=plan.rentals.find(r=>r.id===id);
  if(rental){const property=plan.properties.find(p=>p.id===rental.propertyId);return `${property?.role==='primary-with-adu'?'ADU':'Rental'} ${plan.rentals.filter(r=>r.propertyId===rental.propertyId).findIndex(r=>r.id===id)+1} — ${property?.name??'Property'}`;}
  const contribution=plan.contributions.find(c=>c.id===id);if(contribution)return `${plan.accounts.find(a=>a.id===contribution.accountId)?.name??'Account'} contribution`;
  return id;
}
export function resolveIssueTargets(issue:Issue,state:Pick<WorkspaceState,'savedPlan'|'drafts'>):readonly ReviewTarget[]{
  const plan=state.savedPlan,id=issue.recordId,field=normalizeFieldPath(issue.field??'');
  const target=(section:InputSection,recordId:string,path?:string):ReviewTarget=>({section,recordId,...(path?{field:path}:{}),label:`Review ${section==='Household'?'Household':getRecordLabel(plan,id??recordId)}`});
  const household=Object.hasOwn(state.drafts,'household')?state.drafts.household!.value:{household:plan.household,taxPolicy:plan.taxPolicy,startYear:plan.startYear,horizonYears:plan.horizonYears,openingCashCents:plan.openingCashCents};
  const householdField=(ownerId:string,f:string)=>{const prefix=findRecordPath(household,ownerId);return prefix===undefined?undefined:`${prefix}.${f}`;};
  const householdRows=(ownerId:string,f:string):readonly {year?:unknown;employerId?:unknown}[]=>{
    const path=householdField(ownerId,f),value=path?.split('.').reduce<unknown>((node,key)=>node&&typeof node==='object'?(node as Record<string,unknown>)[key]:undefined,household);
    return Array.isArray(value)?value:[];
  };
  const contribution=plan.contributions.find(c=>c.id===id);
  const filer=plan.household.filers.find(f=>f.id===id);
  if(contribution||filer){
    const ownerId=filer?.id??plan.accounts.find(a=>a.id===contribution!.accountId)?.ownerId;
    if(/birthDate|workplaceCoverage|coverageByYear|employerAssumptionsByYear|spouse/.test(field)){
      const people=/spouse/.test(field)||issue.code==='required-workplace-coverage'?plan.household.filers:plan.household.filers.filter(f=>f.id===ownerId);
      return people.map(person=>{
        let f=field.replace(/^spouse\./,'');
        if(/^workplaceCoverage(?:\.|$)/.test(f)){
          const index=householdRows(person.id,'coverageByYear').findIndex(row=>issue.year!==undefined&&String(row.year)===String(issue.year));
          if(index>=0)f=`coverageByYear.${index}.${f}`;
        }
        if(f.startsWith('employerAssumptionsByYear')&&!/^employerAssumptionsByYear\.\d+(?:\.|$)/.test(f)){
          const salary=plan.salaries.find(s=>s.id===contribution?.sponsoringSalaryId);
          const index=salary?householdRows(person.id,'employerAssumptionsByYear').findIndex(row=>issue.year!==undefined&&String(row.year)===String(issue.year)&&row.employerId===salary.employerId):-1;
          f=index>=0?f.replace('employerAssumptionsByYear',`employerAssumptionsByYear.${index}`):'employerAssumptionsByYear';
        }
        return target('Household','household',householdField(person.id,f));
      });
    }
    if(filer)return [target('Household','household',householdField(filer.id,field))];
  }
  if(!id||id===plan.id||id==='household')return [target('Household','household',field)];
  for(const accountId of new Set([...plan.accounts.map(account=>account.id),...Object.values(state.drafts).filter(draft=>draft.section==='accounts').map(draft=>draft.recordId)])){
    const raw=Object.hasOwn(state.drafts,accountId)?state.drafts[accountId]!.value:plan.accounts.find(account=>account.id===accountId);
    const prefix=findRecordPath(raw,id);
    if(prefix?.startsWith('rsu.grants.'))return [target('Investments',accountId,field===prefix||field.startsWith(`${prefix}.`)?field:field?`${prefix}.${field}`:prefix)];
  }
  const property=plan.properties.find(p=>p.id===id||p.loans.some(l=>l.id===id)||plan.rentals.some(r=>r.id===id&&r.propertyId===p.id));
  if(property){const raw=Object.hasOwn(state.drafts,property.id)?state.drafts[property.id]!.value:{property,rentals:plan.rentals.filter(r=>r.propertyId===property.id),expenses:plan.expenses.filter(e=>e.propertyId===property.id)};const prefix=findRecordPath(raw,id);return [target('Properties',property.id,field.startsWith('property.')||field.startsWith('rentals.')?field:prefix===undefined?undefined:field?`${prefix}.${field}`:prefix)];}
  const sections=[['salaries','Income'],['otherIncome','Income'],['expenses','Expenses and debts'],['debts','Expenses and debts'],['accounts','Investments'],['contributions','Investments']] as const;
  for(const [key,section] of sections)if(plan[key].some(r=>r.id===id)||Object.hasOwn(state.drafts,id)&&state.drafts[id]!.section===key)return [target(section,id,field)];
  return [];
}
