import type {Issue} from '../../engine';
import {formatPeriods,getRecordLabel,groupIssueOccurrences,resolveIssueTargets,withProducingPlan,type IssueGroup,type IssueViewContext,type IssueViewState,type ReviewTarget} from '../issue-presentation';
import type {ReportSnapshot} from '../report-snapshot';
import {appendProvenance,element,issueLabel,renderIssueDetails} from './issues';
import {createReportDisclosureScope} from './report-state';

export type AttentionKind='input'|'missing-data'|'unsupported'|'funding'|'assumption';
export interface AttentionItem {readonly key:string;readonly kind:AttentionKind;readonly title:string;readonly group:IssueGroup;readonly targets:readonly ReviewTarget[]}
const labels:Record<AttentionKind,string>={input:'Input problem','missing-data':'Missing financial data',unsupported:'Unsupported case',funding:'Funding gap',assumption:'Assumption / provenance'};
function classify(issue:Issue,draft:boolean):AttentionKind {
 if(/^unsupported-|unsupported-case/.test(issue.code))return 'unsupported';
 if(/cash-gap|shortfall|funding-conflict|below-interest-payment|negative-amortization/.test(issue.code))return 'funding';
 if(/^(provisional|projected)-rules$|estimate|assumption|unvalued-|omitted-/.test(issue.code))return 'assumption';
 if(draft||/invalid-input|stale-.*draft|calculation-failed|monetary-overflow/.test(issue.code))return 'input';
 return 'missing-data';
}
export function buildAttention(snapshot:ReportSnapshot,draftIssues:readonly Issue[],state:IssueViewState):readonly AttentionItem[] {
 const draftKeys=new Set(draftIssues.map(issue=>JSON.stringify(issue)));
 return groupIssueOccurrences([...snapshot.projection.issues,...draftIssues].map(issue=>({issue}))).map(group=>{
  const first=group.issues[0]!,kind=classify(first,group.issues.some(issue=>draftKeys.has(JSON.stringify(issue))));
  const targets=kind==='unsupported'||kind==='assumption'?[]:[...new Map(group.issues.flatMap(issue=>resolveIssueTargets(issue,state,snapshot.plan)).map(target=>[JSON.stringify(target),target])).values()];
  return {key:group.key,kind,title:`${issueLabel(first)}${first.recordId?' · '+getRecordLabel(snapshot.plan,first.recordId):''}`,group,targets};
 });
}

export function mountAttention(root:HTMLElement,context:IssueViewContext,review:(target:ReviewTarget)=>void):{update(snapshot:ReportSnapshot,issues:readonly Issue[]):void;dispose():void} {
 let disposed=false,generation=0,opened=false,current:ReportSnapshot|undefined;
 const scope=createReportDisclosureScope(context.disclosures),toggle=element('button'),list=element('ul'),announcement=element('p');toggle.type='button';toggle.setAttribute('aria-expanded','false');list.hidden=true;list.className='attention-list';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');root.classList.add('attention');root.replaceChildren(toggle,list,announcement);
 toggle.onclick=()=>{if(disposed)return;opened=!opened;list.hidden=!opened;toggle.setAttribute('aria-expanded',String(opened));if(!opened)context.disclosures.closeWithin(list,false);};
 return {update(snapshot,issues){
  if(disposed)return;const token=++generation;current=snapshot;const state=context.readState(),basePlan=state.savedPlan,items=buildAttention(snapshot,issues,state);
  const owns=()=>!disposed&&token===generation&&current===snapshot&&root.isConnected&&context.readState().savedPlan===basePlan;
  const reportContext=withProducingPlan({...context,disclosures:scope.controller,review:target=>{if(owns())review(target);}},snapshot.plan);
  scope.begin();toggle.textContent=`${items.length} ${items.length===1?'item needs':'items need'} attention`;toggle.hidden=items.length===0;list.hidden=!opened||items.length===0;
  list.replaceChildren(...items.map(item=>{
   const row=element('li');row.dataset.attentionKey=item.key;row.append(element('strong',labels[item.kind]),element('span',item.title));const periods=formatPeriods(item.group.periods);if(periods)row.append(element('small',periods));
   for(const target of item.targets){const button=element('button',target.label);button.type='button';button.onclick=()=>{if(owns()&&button.isConnected)review(target);};row.append(button);}
   const first=item.group.issues[0]!;
   row.append(scope.controller.createTrigger({label:'Explanation',accessibleLabel:`${labels[item.kind]} explanation · ${first.code}`,preview:first.explanation,title:`${labels[item.kind]} · ${first.code}`,renderDetails:node=>{
    if(item.kind==='unsupported'||item.kind==='assumption'){
     node.append(element('p',item.title));for(const issue of item.group.issues)node.append(element('p',issue.explanation),element('p',issue.resolution));if(periods)node.append(element('p',periods));
     if(item.kind==='assumption')appendProvenance(node,snapshot.projection.provenance);
    }else renderIssueDetails(node,item.group.issues.map(issue=>({issue})),reportContext);
   }}));return row;
  }));
  if(scope.finish())announcement.textContent='The selected issue has been resolved.';
 },dispose(){if(disposed)return;disposed=true;generation++;scope.dispose();toggle.onclick=null;context.disclosures.closeWithin(root,false);}};
}
