import type { Available,Coverage,Issue,RuleProvenance } from '../../engine';

export function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;
}
const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const percentage=new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:2});
export const formatCents=(cents:number):string=>usd.format(cents/100);
export function appendAmount(root:HTMLElement,value:Available<number>,kind:'money'|'ratio'='money'):void {
  if(value.status==='available'){root.append(element('span',kind==='money'?formatCents(value.value):percentage.format(value.value)));return;}
  root.append(element('strong',value.status==='needs-data'?'Needs data':'Unsupported case'));
  const issues=[...new Map(value.issues.map(issue=>[JSON.stringify(issue),issue])).values()];
  if(!issues.length){root.append(element('p',value.status==='needs-data'?'Supporting information is missing.':'This case exceeds the supported calculation.'),element('p','Resolve the affected inputs before using this amount.'));return;}
  for(const issue of issues)root.append(element('p',issue.explanation),element('p',issue.resolution));
}
export function moneyEntry(root:HTMLElement,label:string,value:Available<number>|number,testId?:string):void {
  root.append(element('dt',label));const cell=element('dd');if(testId)cell.dataset.testid=testId;
  appendAmount(cell,typeof value==='number'?{status:'available',value}:value);root.append(cell);
}
export function appendCoverage(root:HTMLElement,coverage:Coverage):void {
  root.append(element('p',coverage.completeForModeledScope?'Complete modeled scenario':'Incomplete modeled scenario'),element('p',coverage.completeHouseholdLiability?'Complete household liability':'Incomplete household liability'));
}
export function appendProvenance(root:HTMLElement,provenance:readonly RuleProvenance[]):void {
  const statuses=[...new Set(provenance.map(p=>p.status))];
  for(const status of statuses)root.append(element('p',status==='verified'?'Verified rules':status==='provisional'?'Provisional rules':'Projected rules'));
  const details=element('details');details.append(element('summary','Sources and rule assumptions'));
  if(!provenance.length)details.append(element('p','Rule provenance is unavailable for this result.'));
  else {
    details.append(element('p',`Rule baseline ${[...new Set(provenance.map(p=>p.baselineYear))].join(', ')}; applied years ${[...new Set(provenance.map(p=>p.applicableYear))].join(', ')}.`),element('p',`Rule versions: ${[...new Set(provenance.map(p=>p.ruleVersion))].join(', ')}.`));
    const assumptions=[...new Set(provenance.flatMap(p=>p.assumptions))];
    if(assumptions.length){const list=element('ul');for(const assumption of assumptions)list.append(element('li',assumption));details.append(list);}
    const list=element('ul');
    for(const url of [...new Set(provenance.flatMap(p=>p.sources))]){
      const row=element('li');const link=element('a',url);link.href=url;link.target='_blank';link.rel='noopener noreferrer';row.append(link);list.append(row);
    }
    details.append(list);
  }
  root.append(details);
}
export function renderIssues(root:HTMLElement,issues:readonly Issue[]):void {
  root.replaceChildren();root.append(element('h3','Issues and next steps'));
  if(!issues.length){root.append(element('p','No issues in this view.'));return;}
  const list=element('ul');
  for(const issue of [...new Map(issues.map(issue=>[JSON.stringify(issue),issue])).values()]){
    const row=element('li');row.className=`issue-${issue.severity}`;
    row.append(element('strong',[issue.severity,issue.year===undefined?undefined:String(issue.year),issue.recordId,issue.field].filter(Boolean).join(' · ')),element('p',issue.explanation),element('p',issue.resolution));list.append(row);
  }
  root.append(list);
}
