import {findAduOwner,getAduProjects} from '../engine/property/adu-ownership';
import type {EditorViewSession} from './scenario-session';
import type {AllocationDestination,Issue,PlanDocument} from '../engine';
import type {DisclosureController} from './disclosures';
import type {WorkspaceState} from './state';
export type ReportPeriod=Readonly<{year:number;month?:number}>;
export type IssueOccurrence=Readonly<{issue:Issue;period?:ReportPeriod}>;
export type IssueGroup=Readonly<{key:string;issues:readonly Issue[];periods:readonly ReportPeriod[]}>;
export type InputSection='Household'|'Income'|'Expenses and debts'|'Investments'|'Properties';
export type ReviewTarget=Readonly<{section:InputSection;recordId:string;field?:string;label:string}>;
export type IssueViewState=Pick<WorkspaceState,'savedPlan'|'drafts'|'allocationDraft'>;
export interface IssueViewContext {readonly editorView?:EditorViewSession;readonly disclosures:DisclosureController;readonly readState:()=>IssueViewState;readonly review:(target:ReviewTarget)=>void;/** Plan that produced a report, including a retained valid preview. */readonly allocationPlan?:PlanDocument}
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
function propertyIssueField(raw:unknown,id:string,field:string):string|undefined {
 const prefix=findRecordPath(raw,id);if(prefix===undefined)return undefined;
 if(/^(property|rentals|expenses)\./.test(field))return field;
 if(!prefix.startsWith('property.aduProject'))return field?`${prefix}.${field}`:prefix;
 let relative=field.replace(/^aduProject\./,'');
 const project=valueAtProject(raw);
 const visit=(value:unknown):void=>{if(!value||typeof value!=='object')return;
  if('id' in value&&typeof value.id==='string'){
   const path=findRecordPath(raw,value.id)!.replace(/^property\.aduProject\./,''),collection=path.slice(0,path.lastIndexOf('.'));
   for(const head of [`${collection}.${value.id}`,`propertyTax.${value.id}`])if(relative===head||relative.startsWith(`${head}.`))relative=path+relative.slice(head.length);
  }Object.values(value).forEach(visit);
 };visit(project);
 const projectPrefix='property.aduProject';
 if(prefix===projectPrefix)return relative?`${projectPrefix}.${relative}`:prefix;
 const ownPath=prefix.slice(projectPrefix.length+1),ownCollection=ownPath.slice(0,ownPath.lastIndexOf('.'));
 for(const head of [ownPath,`${ownCollection}.${id}`,`propertyTax.${id}`])if(relative===head||relative.startsWith(`${head}.`))return `${projectPrefix}.${relative}`;
 return relative&&prefix.endsWith(`.${relative}`)?prefix:relative?`${prefix}.${relative}`:prefix;
}
function valueAtProject(raw:unknown):unknown{return (raw as {property?:{aduProject?:unknown}})?.property?.aduProject;}
export function getRecordLabel(plan:PlanDocument,id:string):string{
  if(id===plan.id||id==='household')return 'Household';
  const policy=plan.cashFlowAllocation;
  if(policy){
    if(id===policy.id)return 'Cash flow allocation';
    const source=policy.entries.find(entry=>entry.id===id)??(policy.overflow.id===id?policy.overflow:undefined);
    if(source)return `${source===policy.overflow?'Excess allocation':'Allocation'} · ${source.destination.kind==='cash'?'Cash / savings':getRecordLabel(plan,source.destination.accountId)}`;
  }
  for(const record of [...plan.household.filers,...plan.salaries,...plan.otherIncome,...plan.expenses,...plan.children??[],...plan.debts,...plan.accounts,...plan.properties,...plan.properties.flatMap(p=>p.loans)])if(record.id===id)return record.name;
  for(const {project} of getAduProjects(plan)){if(project.id===id)return project.name;for(const row of [...project.costs,...(project.financing?[project.financing]:[])])if(row.id===id)return row.name;}
  for(const account of plan.accounts)for(const grant of account.rsu?.grants??[])if(grant.id===id)return grant.name;
  const rental=plan.rentals.find(r=>r.id===id);
  if(rental){const property=plan.properties.find(p=>p.id===rental.propertyId);return `${property?.role==='primary-with-adu'?'ADU':'Rental'} ${plan.rentals.filter(r=>r.propertyId===rental.propertyId).findIndex(r=>r.id===id)+1} — ${property?.name??'Property'}`;}
  const contribution=plan.contributions.find(c=>c.id===id);if(contribution)return `${plan.accounts.find(a=>a.id===contribution.accountId)?.name??'Account'} contribution`;
  return id;
}
export function resolveIssueTargets(issue:Issue,state:IssueViewState,sourcePlan:PlanDocument=state.savedPlan):readonly ReviewTarget[]{
  const plan=state.savedPlan,id=issue.recordId,field=normalizeFieldPath(issue.field??'');
  const policy=sourcePlan.cashFlowAllocation;
  if(policy&&(id===policy.id||policy.entries.some(entry=>entry.id===id)||id===policy.overflow.id)){
    const match=/^(?:cashFlowAllocation\.)?entries\.(\d+)(?:\.(.*))?$/.exec(field);
    const overflow=/^(?:cashFlowAllocation\.)?overflow(?:\.(.*))?$/.exec(field);
    const source=id===policy.id?(match?policy.entries[Number(match[1])]:overflow?policy.overflow:undefined):policy.entries.find(entry=>entry.id===id)??policy.overflow;
    const suffix=match?match[2]??'':overflow?overflow[1]??'':field.replace(/^cashFlowAllocation\.?/,'');
    const destination:AllocationDestination|undefined=source?.destination;
    const account=destination?.kind==='account'?plan.accounts.find(a=>a.id===destination.accountId):undefined;
    const salary=destination?.kind==='account'?plan.salaries.find(s=>s.id===destination.sponsoringSalaryId):undefined;
    if(account&&/birthDate|workplaceCoverage|coverageByYear|employerAssumptionsByYear|spouse/.test(suffix)){
      const {cashFlowAllocation:_,...document}=plan;
      return resolveIssueTargets({...issue,recordId:source!.id,field:suffix},{...state,savedPlan:{...document,contributions:[...plan.contributions,{id:source!.id,accountId:account.id,priority:0,startDate:`${issue.year??plan.startYear}-01-01`,amount:{kind:'fixed',monthlyCents:0},...(salary?{sponsoringSalaryId:salary.id}:{} )}]}});
    }
    if(salary&&/sponsoringSalaryId|employerId|compensation|wages|startDate|endDate/.test(suffix))return [{section:'Income',recordId:salary.id,label:`Review ${salary.name}`}];
    if(account&&issue.code==='mandatory-roth-catchup')return resolveIssueTargets({...issue,recordId:account.id,field:'type'},state);
    if(account&&/^(openingIraBasis|ownerId|type|openingBalanceCents)(?:\.|$)/.test(suffix))return resolveIssueTargets({...issue,recordId:account.id,field:suffix},state);
    const raw=state.allocationDraft?.recordId===policy.id?state.allocationDraft.value:plan.cashFlowAllocation;
    const rows=raw?.entries;
    const index=source&&Array.isArray(rows)?rows.findIndex(row=>row&&typeof row==='object'&&row.id===source.id):-1;
    const isOverflow=source?.id===policy.overflow.id&&raw?.overflow&&typeof raw.overflow==='object'&&'id' in raw.overflow&&raw.overflow.id===source.id;
    // A removed source has no field target; never substitute the row now at its old index.
    // Excess has an automatic amount; its destination is the editable remedy for amount limits.
    const overflowSuffix=isOverflow&&/^amount(?:\.|$)/.test(suffix)?'destination':suffix;
    const path=isOverflow?`overflow${overflowSuffix?'.'+overflowSuffix:''}`:index>=0?`entries.${index}${suffix?'.'+suffix:''}`:source||match||overflow?undefined:suffix;
    return [{section:'Investments',recordId:policy.id,...(path?{field:path}:{}),label:`Review ${source?getRecordLabel(sourcePlan,source.id):'Cash flow allocation'}`}];
  }
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
  const aduOwner=findAduOwner(plan,id);
  const draftOwner=Object.values(state.drafts).find(d=>d.section==='properties'&&findRecordPath(d.value,id)!==undefined)?.recordId;
  const property=plan.properties.find(p=>p.id===aduOwner?.propertyId||p.id===draftOwner||p.id===id||p.loans.some(l=>l.id===id)||plan.rentals.some(r=>r.id===id&&r.propertyId===p.id));
  if(property){
    const raw=Object.hasOwn(state.drafts,property.id)?state.drafts[property.id]!.value:{property,rentals:plan.rentals.filter(r=>r.propertyId===property.id),expenses:plan.expenses.filter(e=>e.propertyId===property.id)};
    const propertyField=field.replace(/^(aduProject\.)?ownerFunding\.(?:kind|accountId)$/,'$1ownerFunding');
    let path=propertyIssueField(raw,id,propertyField);
    if(issue.code==='required-adu-tax-payments'&&issue.year!==undefined&&path==='property.aduProject.propertyTax.paymentYears'){
      const years=(valueAtProject(raw) as {propertyTax?:{paymentYears?:readonly {year?:unknown}[]}}|undefined)?.propertyTax?.paymentYears;
      const index=Array.isArray(years)?years.findIndex(row=>row&&String(row.year)===String(issue.year)):-1;
      if(index>=0)path+=`.${index}.complete`;
    }
    return [target('Properties',property.id,path)];
  }
  const sections=[['salaries','Income'],['otherIncome','Income'],['expenses','Expenses and debts'],['children','Expenses and debts'],['debts','Expenses and debts'],['accounts','Investments'],['contributions','Investments']] as const;
  for(const [key,section] of sections)if((plan[key]??[]).some(r=>r.id===id)||Object.hasOwn(state.drafts,id)&&state.drafts[id]!.section===key)return [target(section,id,field)];
  return [];
}
