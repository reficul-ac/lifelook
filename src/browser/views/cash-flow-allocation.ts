import type {AnnualProjection,Available,CashFlowAllocationYear,PlanDocument,Issue} from '../../engine';
import {getRecordLabel,type IssueViewContext} from '../issue-presentation';
import {appendAmount,element,formatCents,renderIssueDetails} from './issues';

const colors=['#205e44','#b77714','#467db0','#9a6093','#798d35','#b56b4f'];
function note(issues:readonly Issue[],excess=true):string{
  if(issues.length&&issues.every(i=>i.code==='allocation-existing-above-target'))return 'Existing deposits exceed the target and retain their saved amounts and dates.';
  const deposit=excess?'excess deposit':'full target';
  if(issues.some(i=>/^required-|missing|unknown|needs-data/.test(i.code)))return `Eligibility information is missing; the ${deposit} could not be confirmed.`;
  if(issues.some(i=>/timing|compensation|payroll/.test(i.code)))return `Compensation timing prevented the ${deposit}.`;
  if(issues.some(i=>/capped|limit|ineligible|phaseout|catchup-not-offered|mandatory-roth/.test(i.code)))return `A confirmed contribution limit or eligibility restriction prevented the ${deposit}.`;
  return excess?'The excess destination could not accept the full amount; the remainder stays in cash.':'Available annual cash could not fully fund the target while preserving earlier allocations.';
}
function details(root:HTMLElement,issues:readonly Issue[],year:number,context:IssueViewContext):void{
  if(issues.length)renderIssueDetails(root,issues.map(issue=>({issue,period:{year}})),context);
}
function cashReasons(value:CashFlowAllocationYear,plan:PlanDocument):readonly Issue[]{
  const policy=plan.cashFlowAllocation,entry=policy?.entries.find(entry=>entry.destination.kind==='cash');
  if(!policy||!entry)return [];
  const prefix=`cashFlowAllocation.entries.${policy.entries.findIndex(source=>source.id===entry.id)}.`;
  return value.reasons.filter(issue=>issue.recordId===entry.id||issue.recordId===policy.id&&issue.field?.startsWith(prefix));
}
function fundingTable(root:HTMLElement,value:CashFlowAllocationYear,plan:PlanDocument,context:IssueViewContext):void{
  const wrap=element('div');wrap.className='allocation-table-wrap';
  const table=element('table');table.append(element('caption',`Actual allocation funding · ${value.year}`));
  const head=element('thead'),header=element('tr');
  for(const label of ['Destination','Target','Actual funded / retained cash','Actual share','Existing deposits','Percentage top up / saving','Annual maximum','Excess funding','Shortfall']){const cell=element('th',label);cell.scope='col';header.append(cell);}head.append(header);table.append(head);
  const body=element('tbody');
  for(const account of value.accounts){
    const row=element('tr'),label=getRecordLabel(plan,account.accountId),title=element('th',label);title.scope='row';row.append(title);
    if(account.shortfallCents>0||account.reasons.some(i=>i.code==='allocation-existing-above-target'))title.append(context.disclosures.createTrigger({label:account.shortfallCents>0?'Partially funded':'ⓘ',accessibleLabel:`${label} funding details · ${value.year}`,title:`${label} funding · ${value.year}`,preview:account.shortfallCents>0?`${formatCents(account.shortfallCents)} below target. ${note(account.reasons,false)}`:note(account.reasons,false),renderDetails:node=>{
      node.append(element('p',`${label} · ${value.year}: target ${formatCents(account.targetCents)}, actual funded ${formatCents(account.actualCents)}, shortfall ${formatCents(account.shortfallCents)}.`));details(node,account.reasons,value.year,context);
    }}));
    function amount(cents:number){const cell=element('td');appendAmount(cell,{status:'available',value:cents},context,{label,period:{year:value.year}});row.append(cell);}
    amount(account.targetCents);amount(account.actualCents);
    const share=element('td');
    if(value.originalCashFlowCents>0)appendAmount(share,{status:'available',value:account.actualCents/value.originalCashFlowCents},context,{label:`${label} actual share`,period:{year:value.year}},'ratio');else share.textContent='N/A · no positive budget';row.append(share);
    amount(account.existingCents);amount(account.percentageCents);amount(account.maximumCents);amount(account.excessCents);amount(account.shortfallCents);body.append(row);
  }
  const cash=element('tr'),name=element('th','Cash / savings');name.scope='row';
  if(value.explicitCashShortfallCents>0)name.append(context.disclosures.createTrigger({label:'Partially funded',accessibleLabel:`Cash / savings target funding details · ${value.year}`,title:`Cash / savings target funding · ${value.year}`,preview:`${formatCents(value.explicitCashShortfallCents)} below the saving target. ${note(cashReasons(value,plan),false)}`,renderDetails:node=>{
    node.append(element('p',`Cash / savings · ${value.year}: saving target ${formatCents(value.explicitCashTargetCents)}, actual earmark ${formatCents(value.explicitCashCents)}, shortfall ${formatCents(value.explicitCashShortfallCents)}.`));details(node,cashReasons(value,plan),value.year,context);
  }}));
  const retained=element('td',formatCents(value.retainedCashCents));retained.append(element('div','Total retained'));
  cash.append(name,element('td',formatCents(value.explicitCashTargetCents)),retained);
  const cashShare=element('td');if(value.originalCashFlowCents>0)appendAmount(cashShare,{status:'available',value:value.retainedCashCents/value.originalCashFlowCents},context,{label:'Cash actual share',period:{year:value.year}},'ratio');else cashShare.textContent='N/A · no positive budget';cash.append(cashShare);
  cash.append(element('td','—'),element('td',`Explicit saving: ${formatCents(value.explicitCashCents)}`),element('td','—'),element('td','—'),element('td',formatCents(value.explicitCashShortfallCents)));body.append(cash);
  const breakdownRow=element('tr'),breakdownLabel=element('th','Retained cash breakdown');breakdownLabel.scope='row';breakdownRow.append(breakdownLabel);
  const breakdown=element('td');breakdown.colSpan=8;breakdown.append(element('span',`Explicit saving: ${formatCents(value.explicitCashCents)}; other retained cash: ${formatCents(value.retainedCashCents-value.explicitCashCents-value.excessRetainedCents)}; excess retained: ${formatCents(value.excessRetainedCents)}.`));
  const overflow=plan.cashFlowAllocation?.overflow;
  if(value.excessRetainedCents>0&&overflow?.destination.kind==='account'){
    const destination=getRecordLabel(plan,overflow.destination.accountId);
    const reasons=value.reasons.filter(i=>i.recordId===overflow.id||i.field?.includes('overflow'));
    breakdown.append(context.disclosures.createTrigger({label:'ⓘ',accessibleLabel:`Cash retained details · ${value.year}`,title:`Cash retained · ${value.year}`,preview:note(reasons),renderDetails:node=>{
      node.append(element('p',`${value.year} · ${destination}: excess offered ${formatCents(value.excessOfferedCents)}, accepted ${formatCents(value.excessAcceptedCents)}, retained in cash ${formatCents(value.excessRetainedCents)}.`),element('p',note(reasons)));details(node,reasons,value.year,context);
      if(!reasons.length){const button=element('button',`Review ${destination}`);button.type='button';button.addEventListener('click',()=>context.review({section:'Investments',recordId:overflow.destination.kind==='account'?overflow.destination.accountId:overflow.id,label:`Review ${destination}`}));node.append(button);}
    }}));
  }
  breakdownRow.append(breakdown);body.append(breakdownRow);table.append(body);wrap.append(table);root.append(wrap);
}
export function renderAllocationPie(root:HTMLElement,report:Available<CashFlowAllocationYear>,plan:PlanDocument,context:IssueViewContext):void{
  context.disclosures.closeWithin(root,false);root.replaceChildren();const viewContext={...context,allocationPlan:plan};
  if(report.status!=='available'){
    root.append(element('p','Allocation funding is unavailable.'));
    appendAmount(root,report,viewContext,{label:'Cash flow allocation'});return;
  }
  const value=report.value;root.append(element('p',`Original cash flow · ${value.year}: ${formatCents(value.originalCashFlowCents)}`));
  if(value.status==='funding-conflict')root.append(element('p','Funding conflict: existing deposits exceed the allocation budget.'));
  else if(value.status==='no-surplus'||value.originalCashFlowCents<=0)root.append(element('p','No positive allocation budget.'));
  else {
    const total=value.accounts.reduce((sum,a)=>sum+a.actualCents,0)+value.retainedCashCents;
    if(total!==value.originalCashFlowCents||value.accounts.some(a=>a.share.status!=='available'))root.append(element('p','Allocation funding is incomplete; no reconciled pie is available.'));
    else {
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 200 200');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${value.year} actual cash flow allocation`);svg.classList.add('allocation-pie');
      let start=-Math.PI/2;
      const slices=[...value.accounts.map(a=>({id:a.accountId,label:getRecordLabel(plan,a.accountId),cents:a.actualCents})),{id:'cash',label:'Cash / savings',cents:value.retainedCashCents}];
      slices.forEach((slice,index)=>{
        const angle=slice.cents/value.originalCashFlowCents*360,radians=angle*Math.PI/180,end=start+radians;
        const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('data-allocation-slice',slice.id);path.setAttribute('data-angle',String(angle));path.setAttribute('fill',colors[index%colors.length]!);
        const x=(r:number)=>100+90*Math.cos(r),y=(r:number)=>100+90*Math.sin(r);
        path.setAttribute('d',angle===360?'M 100 10 A 90 90 0 1 1 100 190 A 90 90 0 1 1 100 10 Z':angle===0?'M 100 100':`M 100 100 L ${x(start)} ${y(start)} A 90 90 0 ${angle>180?1:0} 1 ${x(end)} ${y(end)} Z`);
        const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${slice.label}: ${formatCents(slice.cents)}`;path.append(title);svg.append(path);start=end;
      });root.append(svg);
    }
  }
  fundingTable(root,value,plan,viewContext);
  root.append(element('p',`Excess offered: ${formatCents(value.excessOfferedCents)} · Excess accepted: ${formatCents(value.excessAcceptedCents)} · Excess retained: ${formatCents(value.excessRetainedCents)}`));
  const savingReasons=value.explicitCashShortfallCents>0?cashReasons(value,plan):[];
  const meaningfulReasons=value.reasons.filter(issue=>savingReasons.includes(issue)||issue.code==='allocation-existing-above-target'||value.status!=='funded'||value.accounts.some(account=>account.shortfallCents>0&&account.reasons.some(reason=>reason.code===issue.code&&reason.recordId===issue.recordId&&reason.field===issue.field))||value.excessRetainedCents>0&&plan.cashFlowAllocation?.overflow.destination.kind==='account'&&(issue.recordId===plan.cashFlowAllocation.overflow.id||issue.field?.includes('overflow')));
  if(meaningfulReasons.length){const reasons=element('div');reasons.append(context.disclosures.createTrigger({label:'Allocation notes',accessibleLabel:`Allocation notes · ${value.year}`,title:`Allocation notes · ${value.year}`,preview:note(meaningfulReasons,value.excessRetainedCents>0&&plan.cashFlowAllocation?.overflow.destination.kind==='account'),renderDetails:node=>details(node,meaningfulReasons,value.year,viewContext)}));root.append(reasons);}
}
export function renderAllocationYears(root:HTMLElement,years:readonly AnnualProjection[],context:IssueViewContext):void{
  context.disclosures.closeWithin(root,false);root.replaceChildren();const reports=years.filter(year=>year.cashFlowAllocation!==undefined);if(!reports.length)return;
  root.classList.add('allocation-years');root.append(element('h3','Annual cash flow allocation'));
  for(const year of reports){const section=element('section');section.append(element('h4',String(year.year)));const report=element('div');renderAllocationPie(report,year.cashFlowAllocation!,context.readState().savedPlan,context);section.append(report);root.append(section);}
}
