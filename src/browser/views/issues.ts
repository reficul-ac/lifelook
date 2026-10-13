import {groupIssueOccurrences,formatPeriods,getRecordLabel,resolveIssueTargets,type IssueViewContext,type AmountScope,type IssueGroup,type IssueOccurrence} from '../issue-presentation';
import type { Available,Coverage,Issue,RuleProvenance } from '../../engine';

export function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;
}
const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const percentage=new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:2});
export const formatCents=(cents:number):string=>usd.format(cents/100);
const coverageLabels:Record<string,string>={additionalIncome:'Additional income outside these records',additionalCredits:'Additional household tax credits',qualifiedDividendsOrCapitalGains:'Qualified dividends or capital gains'};
export function issueLabel(issue:Issue):string {
  const field=issue.field?.split('.').pop()??'';
  if(coverageLabels[field])return coverageLabels[field]!;
  const labels:Record<string,string>={'required-tax-coverage':'Tax coverage unconfirmed','required-history':'Missing history','required-age':'Age needed','required-workplace-coverage':'Workplace coverage needed','required-employer-history':'Employer history needed','contribution-capped':'Contribution limit reached','unsupported-tax-case':'Unsupported tax circumstance','provisional-rules':'Provisional rule assumptions','projected-rules':'Projected rule assumptions','cash-gap':'Cash gap','negative-amortization':'Payment below interest'};
  return labels[issue.code]??issue.explanation;
}
export function renderIssueDetails(root:HTMLElement,items:readonly IssueOccurrence[],context:IssueViewContext):void {
  const groups=groupIssueOccurrences(items),coverage=groups.filter(g=>g.issues[0]?.code==='required-tax-coverage'),other=groups.filter(g=>g.issues[0]?.code!=='required-tax-coverage');
  function actions(issues:readonly Issue[]){
    const targets=issues.flatMap(issue=>resolveIssueTargets(issue,context.readState(),context.allocationPlan));
    for(const target of [...new Map(targets.map(target=>[JSON.stringify(target),target])).values()]){
      const button=element('button',target.label);button.type='button';button.addEventListener('click',()=>context.review(target));root.append(button);
    }
  }
  function diagnostic(group:IssueGroup){const details=element('details');details.append(element('summary','Full cause and diagnostics'));for(const issue of group.issues){details.append(element('p',issue.explanation),element('p',issue.resolution),element('code',[issue.code,issue.recordId,issue.field,issue.year].filter(v=>v!==undefined).join(' · ')));}root.append(details);}
  if(coverage.length){root.append(element('h4','Household tax coverage is unconfirmed'));const list=element('ul');for(const group of coverage){list.append(element('li',`${issueLabel(group.issues[0]!)} · ${formatPeriods(group.periods)}`));}root.append(list,element('p','Confirm the three household tax answers before relying on total liability.'));actions([coverage[0]!.issues[0]!]);for(const group of coverage)diagnostic(group);}
  for(const group of other){const issue=group.issues[0]!;root.append(element('h4',`${issueLabel(issue)}${issue.recordId?' · '+getRecordLabel(context.readState().savedPlan,issue.recordId):''}`));const period=formatPeriods(group.periods);if(period)root.append(element('p',period));root.append(element('p',issue.explanation),element('p',/^(provisional|projected)-rules$/.test(issue.code)?'Inspect sources and assumptions for this tax scenario.':issue.resolution));actions([issue]);diagnostic(group);}
}
export function appendAmount(root:HTMLElement,value:Available<number>,context:IssueViewContext,scope:AmountScope,kind:'money'|'ratio'='money'):void {
  if(kind==='ratio'&&value.status==='needs-data'&&value.issues.length>0&&value.issues.every(i=>i.code==='undefined-income-ratio')){const label=element('span','N/A · no income');label.title='Ratios require nonzero income; review the dollar amounts.';root.append(label);return;}
  if(value.status==='available'){root.append(element('span',kind==='money'?formatCents(value.value):percentage.format(value.value)));return;}
  const label=value.status==='needs-data'?'Needs data':'Unsupported',period=scope.period?formatPeriods([scope.period]):'',title=scope.label+(period?' · '+period:'');
  root.append(context.disclosures.createTrigger({label,accessibleLabel:`${label}: ${title}`,title,preview:value.issues.some(i=>i.code==='required-tax-coverage')?'Confirm 3 household tax answers.':value.issues[0]?issueLabel(value.issues[0]):'Supporting information is missing.',renderDetails:node=>{
    if(value.issues.length)renderIssueDetails(node,value.issues.map(issue=>({issue,...(scope.period?{period:scope.period}:{})})),context);
    else node.append(element('p',value.status==='needs-data'?'Supporting information is missing.':'This case exceeds the supported calculation.'),element('p','Review the affected inputs before using this amount.'));
  }}));
}
export function moneyEntry(root:HTMLElement,label:string,value:Available<number>|number,context:IssueViewContext,testId?:string):void {
  root.append(element('dt',label));const cell=element('dd');if(testId)cell.dataset.testid=testId;
  appendAmount(cell,typeof value==='number'?{status:'available',value}:value,context,{label});root.append(cell);
}
export function appendCoverage(root:HTMLElement,coverage:Coverage):void {
  const statuses=element('div');statuses.className='report-statuses';statuses.append(element('span',coverage.completeForModeledScope?'Modeled calculations complete':'Modeled calculations incomplete'),element('span',coverage.completeHouseholdLiability?'Household tax complete':'Household tax incomplete'));root.append(statuses);
}
function sourceTitle(url:string):string {const known:Record<string,string>={'rp-25-32.pdf':'IRS federal tax brackets and deductions','n-25-67.pdf':'IRS retirement contribution limits','p936':'IRS mortgage interest','p527':'IRS residential rental property','i6251':'IRS alternative minimum tax'};try{const parsed=new URL(url);return known[parsed.pathname.split('/').pop()??'']??`${parsed.hostname}${parsed.pathname}`;}catch{return url;}}
export function appendProvenance(root:HTMLElement,provenance:readonly RuleProvenance[]):void {
  const statuses=[...new Set(provenance.map(p=>p.status))];
  const indicator=element('div');indicator.className='report-statuses';for(const status of statuses)indicator.append(element('span',`${status[0]!.toUpperCase()+status.slice(1)} rule components`));root.append(indicator);
  const details=element('details');details.append(element('summary','Sources and rule assumptions'));
  if(!provenance.length)details.append(element('p','Rule provenance is unavailable for this result.'));
  else {
    details.append(element('p',`Rule baseline ${[...new Set(provenance.map(p=>p.baselineYear))].join(', ')}; applied years ${[...new Set(provenance.map(p=>p.applicableYear))].join(', ')}.`),element('p',`Rule versions: ${[...new Set(provenance.map(p=>p.ruleVersion))].join(', ')}.`));
    const assumptions=[...new Set(provenance.flatMap(p=>p.assumptions))];
    if(assumptions.length){const list=element('ul');for(const assumption of assumptions)list.append(element('li',assumption));details.append(list);}
    const list=element('ul');
    for(const url of [...new Set(provenance.flatMap(p=>p.sources))]){
      const row=element('li');const link=element('a',sourceTitle(url));link.href=url;link.target='_blank';link.rel='noopener noreferrer';row.append(link);list.append(row);
    }
    details.append(list);
  }
  root.append(details);
}
export function renderIssues(root:HTMLElement,issues:readonly Issue[],context:IssueViewContext,heading='Issues and next steps'):void {
  context.disclosures.closeWithin(root,false);root.replaceChildren();if(!issues.length)return;
  root.append(element('h3',heading));const list=element('ul');list.className='compact-issues';
  const groups=groupIssueOccurrences(issues.map(issue=>({issue})));const coverage=groups.filter(g=>g.issues[0]!.code==='required-tax-coverage');
  const display=groups.filter(g=>g.issues[0]!.code!=='required-tax-coverage');if(coverage.length)display.unshift(coverage[0]!);
  for(const group of display){const issue=group.issues[0]!,row=element('li');row.className=`issue-${issue.severity}`;const label=coverage.includes(group)?`Tax coverage unconfirmed · ${coverage.length} checks`:issueLabel(issue);row.append(element('span',`${issue.severity} · ${issue.recordId?getRecordLabel(context.readState().savedPlan,issue.recordId)+' · ':''}${formatPeriods(group.periods)} `));row.append(context.disclosures.createTrigger({label,accessibleLabel:`${label} details`,title:label,preview:label,renderDetails:node=>renderIssueDetails(node,(coverage.includes(group)?coverage.flatMap(g=>g.issues):group.issues).map(issue=>({issue})),context)}));list.append(row);}
  root.append(list);
}
