import type {Available,Cents} from '../../engine';
import {withProducingPlan,type IssueViewContext,type ReportIssueContext} from '../issue-presentation';
import {buildOverviewRows,type OverviewMetric,type OverviewRow} from '../overview-model';
import type {ReportSnapshot} from '../report-snapshot';
import type {EditorViewSession} from '../scenario-session';
import {renderForecastSummary} from './forecast-summary';
import {renderForecastPlots} from './forecast-plots';
import {appendAmount,element,formatCents} from './issues';
import {renderProjection} from './projection';
import {createReportDisclosureScope,normalizeReportYears,preserveReportFocus,reconcileReportRegion} from './report-state';

const columns:readonly {key:Exclude<OverviewMetric,'cashFlowCents'>;label:string;slug:string}[]=[
 {key:'reserveCents',label:'Cash balance',slug:'reserve'},
 {key:'accountBalanceCents',label:'Investments',slug:'accounts'},
 {key:'propertyValueCents',label:'Property value',slug:'property'},
 {key:'loanBalanceCents',label:'Total debt',slug:'debt'},
 {key:'netWorthCents',label:'Net worth',slug:'net-worth'},
];
function appendDelta(root:HTMLElement,value:Available<Cents>|null,metric:OverviewMetric,year:number,context:ReportIssueContext):void {
 if(!value)return;
 const change=element('small');change.className='overview-delta';
 if(value.status==='available'){
  change.textContent=`${value.value>0?'+':''}${formatCents(value.value)}`;
  if(metric==='loanBalanceCents'&&value.value!==0)change.append(document.createTextNode(value.value>0?' · Debt increasing':' · Debt decreasing'));
 }else appendAmount(change,value,context,{label:'Change from applied',period:{year}});
 root.append(change);
}
function renderBalanceSheet(root:HTMLElement,rows:readonly OverviewRow[],context:ReportIssueContext):void {
 const scroll=element('div');scroll.className='forecast-summary-wrap';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Annual balance sheet, horizontally scrollable');
 const table=element('table');table.append(element('caption','Annual balance sheet'));const head=element('thead'),header=element('tr');
 for(const label of ['Year',...columns.map(column=>column.label)]){const cell=element('th',label);cell.scope='col';cell.style.position='sticky';cell.style.top='0';header.append(cell);}head.append(header);table.append(head);
 const body=element('tbody');
 for(const row of rows){
  const line=element('tr'),year=element('th',String(row.balance.year));year.scope='row';line.append(year);
  for(const column of columns){const cell=element('td');cell.dataset.testid=`balance-${row.balance.year}-${column.slug}`;appendAmount(cell,row.balance[column.key],context,{label:column.label,period:{year:row.balance.year}});appendDelta(cell,row.deltas[column.key],column.key,row.balance.year,context);line.append(cell);}
  if(row.noComparison){const note=element('small','No applied comparison');year.append(note);}body.append(line);
 }
 table.append(body);scroll.append(table);root.append(scroll,element('small','Year-end balances. Investments include held RSU assets. Total debt includes property loans and other modeled debts.'));
}

export function mountOverview(root:HTMLElement,initial:ReportSnapshot,context:IssueViewContext,view:EditorViewSession):{update(snapshot:ReportSnapshot):void;dispose():void} {
 let snapshot=initial,disposed=false,painted:ReportSnapshot|undefined,paintedYear:number|undefined,reportGeneration=0,diagnosticPlan:ReportSnapshot['plan']|undefined,diagnosticProjection:ReportSnapshot['projection']|undefined;
 const disclosureScope=createReportDisclosureScope(context.disclosures),reportBase={...context,disclosures:disclosureScope.controller};
 const status=element('p');status.className='overview-source';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const issueStatus=element('p');issueStatus.setAttribute('role','status');issueStatus.setAttribute('aria-live','polite');issueStatus.className='visually-hidden';
 const controls=element('div');controls.className='overview-controls';
 const yearLabel=element('label','Forecast year'),yearSelect=element('select');yearSelect.setAttribute('aria-label','Forecast year');yearLabel.append(yearSelect);
 const tableLabel=element('label','Table view'),tableSelect=element('select');tableSelect.setAttribute('aria-label','Table view');for(const [value,title] of [['balance-sheet','Balance sheet'],['financial-overview','Financial overview']] as const){const option=element('option',title);option.value=value;tableSelect.append(option);}tableLabel.append(tableSelect);controls.append(yearLabel,tableLabel);
 const totals=element('dl');totals.className='overview-totals';const balance=element('section'),financial=element('section'),plots=element('details'),details=element('div');plots.append(element('summary','Forecast charts'));const plotContent=element('div');plots.append(plotContent);
 plots.open=view.reportState.expanded.has('plots');plots.ontoggle=()=>{if(plots.open)view.reportState.expanded.add('plots');else view.reportState.expanded.delete('plots');};
 const diagnostics=element('details'),diagnosticToggle=element('summary','Forecast details');diagnostics.className='forecast-details';diagnostics.append(diagnosticToggle,details);diagnostics.open=view.reportState.expanded.has('forecast-details');diagnosticToggle.onclick=()=>{if(!diagnostics.open){view.reportState.expanded.add('forecast-details');update(snapshot,true);}};diagnostics.ontoggle=()=>{if(diagnostics.open){view.reportState.expanded.add('forecast-details');if(diagnosticPlan!==snapshot.plan||diagnosticProjection!==snapshot.projection)update(snapshot,true);}else view.reportState.expanded.delete('forecast-details');};
 root.replaceChildren(status,issueStatus,controls,totals,balance,financial,plots,diagnostics);root.classList.add('overview');
 function saveScroll():void {for(const [key,node] of [['balance-sheet',balance],['financial-overview',financial]] as const){const wrap=node.querySelector<HTMLElement>('.forecast-summary-wrap');if(wrap)view.reportState.scroll.set(key,{top:wrap.scrollTop,left:wrap.scrollLeft});}}
 function paintTotals(rows:readonly OverviewRow[],reportContext:ReportIssueContext):void {
  const row=rows.find(row=>row.balance.year===view.selections.forecastYear)??rows[0];totals.replaceChildren();if(!row)return;
  for(const [label,key,value] of [['Net worth','netWorthCents',row.balance.netWorthCents],['Annual cash flow before investments','cashFlowCents',row.financial.cashFlowCents],['Cash balance','reserveCents',row.balance.reserveCents]] as const){const amount=element('dd');amount.dataset.metric=key;appendAmount(amount,value,reportContext,{label,period:{year:row.balance.year}});appendDelta(amount,row.deltas[key],key,row.balance.year,reportContext);const card=element('div');card.append(element('dt',`${label} · ${row.balance.year}`),amount);totals.append(card);}
 }
 function chooseTable():void {view.reportState.tableView=tableSelect.value==='financial-overview'?'financial-overview':'balance-sheet';balance.hidden=view.reportState.tableView!=='balance-sheet';financial.hidden=!balance.hidden;}
 tableSelect.onchange=chooseTable;
 yearSelect.onchange=()=>{view.selections.forecastYear=Number(yearSelect.value);update(snapshot);};
 function update(next:ReportSnapshot,forceDiagnostics=false):void {
  if(disposed)return;snapshot=next;normalizeReportYears(view,next.plan);
  if(status.textContent!==next.label)status.textContent=next.label;
  if(!forceDiagnostics&&painted&&painted.plan===next.plan&&painted.projection===next.projection&&painted.comparison?.plan===next.comparison?.plan&&painted.comparison?.projection===next.comparison?.projection&&painted.allowDeltas===next.allowDeltas&&paintedYear===view.selections.forecastYear)return;
  const restoreFocus=preserveReportFocus(root);
  saveScroll();disclosureScope.begin();const generation=++reportGeneration;
  const reportContext=withProducingPlan({...reportBase,review:target=>{if(!disposed&&generation===reportGeneration)context.review(target);}},next.plan),rows=buildOverviewRows(next),years=new Set(rows.map(row=>row.balance.year));
  for(const key of view.reportState.expanded){const match=/^year:(\d+):/.exec(key);if(match&&!years.has(Number(match[1])))view.reportState.expanded.delete(key);}
  yearSelect.replaceChildren(...rows.map(row=>{const option=element('option',String(row.balance.year));option.value=String(row.balance.year);return option;}));yearSelect.value=String(view.selections.forecastYear);
  tableSelect.value=view.reportState.tableView;chooseTable();paintTotals(rows,reportContext);
  const nextBalance=element('div');renderBalanceSheet(nextBalance,rows,reportContext);reconcileReportRegion(balance,nextBalance,view.reportState,'balance');
  const nextFinancial=element('div');renderForecastSummary(nextFinancial,rows.map(row=>row.financial),reportContext);reconcileReportRegion(financial,nextFinancial,view.reportState,'financial');
  for(const [key,node] of [['balance-sheet',balance],['financial-overview',financial]] as const){const wrap=node.querySelector<HTMLElement>('.forecast-summary-wrap'),position=view.reportState.scroll.get(key);if(wrap&&position){wrap.scrollTop=position.top;wrap.scrollLeft=position.left;}}
  const nextPlots=element('div');renderForecastPlots(nextPlots,rows.map(row=>row.financial),reportContext,view.selections,()=>{if(disposed||generation!==reportGeneration)return;paintedYear=view.selections.forecastYear;yearSelect.value=String(paintedYear);paintTotals(rows,reportContext);root.dispatchEvent(new CustomEvent('forecast-year-selected',{bubbles:true}));});plotContent.replaceChildren(...nextPlots.childNodes);
  if(forceDiagnostics||diagnostics.open){const nextDetails=element('div');renderProjection(nextDetails,next.projection,reportContext,view,{compact:true});reconcileReportRegion(details,nextDetails,view.reportState,'details');diagnosticPlan=next.plan;diagnosticProjection=next.projection;}
  if(disclosureScope.finish())issueStatus.textContent='The selected report issue has been resolved.';
  painted=next;paintedYear=view.selections.forecastYear;
  restoreFocus();
 }
 update(initial);
 return {update,dispose(){if(disposed)return;saveScroll();disposed=true;disclosureScope.dispose();context.disclosures.closeWithin(root,false);yearSelect.onchange=null;tableSelect.onchange=null;plots.ontoggle=null;diagnostics.ontoggle=null;diagnosticToggle.onclick=null;}};
}
