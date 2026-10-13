import {getRecordLabel,type IssueViewContext} from '../issue-presentation';
import type { AnnualProjection,MonthlyProjection,MonetaryField,ProjectionResult,RsuGrantMonth } from '../../engine';
import { appendAmount,appendCoverage,appendProvenance,element,renderIssues } from './issues';
import { renderTaxExplanation } from './tax-explanation';
import { renderAllocationYears } from './cash-flow-allocation';

const columns:readonly {key:MonetaryField;label:string}[]=[
  {key:'grossIncomeCents',label:'Gross income'},{key:'salaryCents',label:'Salary'},{key:'otherIncomeCents',label:'Other income'},{key:'rentCents',label:'Rent'},
  {key:'federalIncomeTaxCents',label:'Federal income tax'},{key:'californiaIncomeTaxCents',label:'California income tax'},{key:'socialSecurityCents',label:'Social Security'},{key:'medicareCents',label:'Medicare'},{key:'additionalMedicareCents',label:'Additional Medicare'},{key:'sdiCents',label:'SDI'},{key:'totalTaxCents',label:'Total tax'},
  {key:'ordinaryExpensesCents',label:'Ordinary expenses'},{key:'propertyExpensesCents',label:'Property expenses'},{key:'expensesCents',label:'Expenses'},{key:'debtPaymentCents',label:'Debt payments'},{key:'interestCents',label:'Interest'},{key:'principalPaidCents',label:'Principal paid'},
  {key:'requestedContributionCents',label:'Requested contributions'},{key:'eligibleContributionCents',label:'Eligible contributions'},{key:'preventedContributionCents',label:'Prevented contributions'},{key:'accountGrowthCents',label:'Account growth'},{key:'propertyGrowthCents',label:'Property growth'},
  {key:'cashFlowCents',label:'Cash flow'},{key:'accountBalanceCents',label:'Account balance'},{key:'propertyValueCents',label:'Property value'},{key:'loanBalanceCents',label:'Loan balance'},{key:'equityCents',label:'Equity'},{key:'reserveCents',label:'Cash reserve'},{key:'netWorthCents',label:'Net worth'},
];
const slug=(key:string)=>key.replace(/Cents$/,'').replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`);
const available=(value:number)=>({status:'available' as const,value});
function assetTable(root:HTMLElement,caption:string,headers:readonly string[]):HTMLTableSectionElement {
  const scroll=element('div');scroll.className='projection-table-wrap';const table=element('table');table.append(element('caption',caption));const head=element('thead'),line=element('tr');for(const label of headers){const cell=element('th',label);cell.scope='col';line.append(cell);}head.append(line);table.append(head);const body=element('tbody');table.append(body);scroll.append(table);root.append(scroll);return body;
}
function rsuGrantTable(root:HTMLElement,grants:readonly RsuGrantMonth[],prefix:string,context:IssueViewContext,showMonth=false):void {
  const quantities=[['vestedShares','Service vested shares'],['withheldShares','Withheld shares'],['heldShares','Held shares'],['unvestedShares','Unvested shares'],['unsettledShares','Unsettled shares']] as const;
  const amounts=[['openingValueCents','Opening held value'],['growthCents','Unrealized growth'],['vestedValueCents','Vested value'],['taxableIncomeCents','Taxable compensation'],['withholdingCents','Withholding funding'],['closingValueCents','Held value'],['unvestedValueCents','Unvested value']] as const;
  const body=assetTable(root,'RSU grants and held shares',[...(showMonth?['Month']:[]),'Account / grant',...quantities.map(([,label])=>label),...amounts.map(([,label])=>label),'Held-share basis']);
  for(const grant of grants){const row=element('tr'),period={year:grant.year,month:grant.month},id=showMonth?`${prefix}-${String(grant.month).padStart(2,'0')}`:prefix;if(showMonth)row.append(element('td',`${grant.year}-${String(grant.month).padStart(2,'0')}`));const label=element('th',`${getRecordLabel(context.readState().savedPlan,grant.accountId)} / ${getRecordLabel(context.readState().savedPlan,grant.grantId)}`);label.scope='row';row.append(label);
    for(const [key] of quantities)row.append(element('td',new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(grant[key])));
    for(const [key,title] of amounts){const cell=element('td');cell.dataset.testid=`${id}-rsu-${grant.grantId}-${key==='taxableIncomeCents'?'taxable-income':slug(key)}`;const value=grant[key];appendAmount(cell,value===null?{status:'unsupported-case',issues:grant.unvestedValueIssue?[grant.unvestedValueIssue]:[]}:available(value),context,{label:title,period});row.append(cell);}
    const basis=element('td');if(grant.basis.known)appendAmount(basis,available(grant.basis.value),context,{label:'Held-share basis',period});else basis.textContent='Unknown';row.append(basis);body.append(row);
  }
}
function movementTable(root:HTMLElement,rows:readonly (AnnualProjection|MonthlyProjection)[],caption:string,context:IssueViewContext):void {
  const scroll=element('div');scroll.className='projection-table-wrap';scroll.style.overflowX='auto';
  const table=element('table');table.append(element('caption',caption));const head=element('thead'),header=element('tr');
  const period=element('th','Period');period.scope='col';header.append(period);
  for(const column of columns){const cell=element('th',column.label);cell.scope='col';if(column.key==='sdiCents')cell.append(context.disclosures.createTrigger({label:'ⓘ',accessibleLabel:'ⓘ About SDI',preview:'California State Disability Insurance deducted from wages.',title:'California SDI',renderDetails:node=>{node.textContent='California State Disability Insurance deducted from wages; separate from income tax.';}}));header.append(cell);}head.append(header);table.append(head);
  const body=element('tbody');
  for(const row of rows){
    const line=element('tr'),isMonth='month'in row,period=isMonth?row.date:String(row.year),prefix=isMonth?`monthly-${row.date}`:`annual-${row.year}`;
    const label=element('th',period);label.scope='row';line.append(label);
    for(const column of columns){const cell=element('td');cell.dataset.testid=`${prefix}-${slug(column.key)}`;appendAmount(cell,row[column.key],context,{label:column.label,period:{year:row.year,...(isMonth?{month:row.month}:{})}});line.append(cell);}body.append(line);
  }
  table.append(body);scroll.append(table);root.append(scroll);
}
function records(root:HTMLElement,row:AnnualProjection|MonthlyProjection,prefix:string,context:IssueViewContext):void {
  if(!row.accounts.length&&!row.properties.length&&!row.loans.length&&!row.rsu)return;
  const details=element('details');details.append(element('summary',`Asset and loan balances · ${'date'in row?row.date:row.year}`));
  function table(caption:string,headers:readonly string[]):{table:HTMLTableElement;body:HTMLTableSectionElement}{
    const body=assetTable(details,caption,headers);return{table:body.parentElement as HTMLTableElement,body};
  }
  function cell(line:HTMLTableRowElement,value:Parameters<typeof appendAmount>[1],id?:string){const node=element('td');if(id)node.dataset.testid=id;appendAmount(node,value,context,{label:id??'Asset balance',period:{year:row.year,...('month' in row?{month:row.month}:{})}});line.append(node);}
  const plan=context.readState().savedPlan,ordinary=row.accounts.filter(account=>plan.accounts.find(a=>a.id===account.accountId)?.type!=='rsu'),rsuAccounts=row.accounts.filter(account=>plan.accounts.find(a=>a.id===account.accountId)?.type==='rsu');
  if(ordinary.length){const {body}=table('Account balances and flows',['Account','Opening balance','Eligible deposit','Growth','Closing balance']);for(const account of ordinary){const line=element('tr');line.append(element('th',getRecordLabel(plan,account.accountId)));cell(line,account.openingCents);cell(line,account.contributionCents);cell(line,account.growthCents);cell(line,account.closingCents,`${prefix}-account-${account.accountId}-closing`);body.append(line);}}
  if(rsuAccounts.length){const {body}=table('RSU held balances and vesting',['Account','Opening held value','Vested value','Withholding funding','Unrealized growth','Closing held value']);for(const account of rsuAccounts){const line=element('tr');line.append(element('th',getRecordLabel(plan,account.accountId)));cell(line,account.openingCents);cell(line,account.vestedCents??(row.rsu?.status==='available'?available(row.rsu.value.grants.filter(grant=>grant.accountId===account.accountId).reduce((sum,grant)=>sum+grant.vestedValueCents,0)):row.rsu??{status:'needs-data',issues:[]}));cell(line,account.withholdingCents??(row.rsu?.status==='available'?available(row.rsu.value.grants.filter(grant=>grant.accountId===account.accountId).reduce((sum,grant)=>sum+grant.withholdingCents,0)):row.rsu??{status:'needs-data',issues:[]}));cell(line,account.growthCents);cell(line,account.closingCents,`${prefix}-account-${account.accountId}-closing`);body.append(line);}}
  if(row.rsu){
    details.append(element('p','Unvested value is excluded from held assets. Deferred unsettled shares remain outside available assets. Withholding funding offsets modeled taxes without creating spendable wage cash.'));
    if(row.rsu.status==='available')rsuGrantTable(details,row.rsu.value.grants,prefix,context);
    else{const status=element('p');appendAmount(status,row.rsu,context,{label:'RSU aggregate',period:{year:row.year,...('month' in row?{month:row.month}:{})}});details.append(status);}
  }
  if(row.properties.length){const {body}=table('Property values and equity',['Property','Opening value','Growth','Closing value','Closing loans','Equity']);for(const property of row.properties){const line=element('tr');line.append(element('th',getRecordLabel(context.readState().savedPlan,property.propertyId)));cell(line,property.openingValueCents);cell(line,property.growthCents);cell(line,property.closingValueCents);cell(line,property.loanBalanceCents);cell(line,property.equityCents,`${prefix}-property-${property.propertyId}-equity`);body.append(line);}}
  if(row.loans.length){const {body}=table('Loan balances and payments',['Loan','Opening principal','Interest','Full payment','Principal paid','Closing principal']);for(const loan of row.loans){const line=element('tr');line.append(element('th',getRecordLabel(context.readState().savedPlan,loan.loanId)));cell(line,loan.openingPrincipalCents);cell(line,loan.interestCents);cell(line,loan.paymentCents);cell(line,loan.principalPaidCents);cell(line,loan.closingPrincipalCents,`${prefix}-loan-${loan.loanId}-closing`);body.append(line);}}
  if(!row.accounts.length&&!row.properties.length&&!row.loans.length&&!row.rsu)details.append(element('p','No asset or loan records in this period.'));
  root.append(details);
}
function expandButton(root:HTMLElement,label:string,hiddenLabel:string,target:HTMLElement,id:string,render:()=>void,context:IssueViewContext):void {
  target.id=id;target.hidden=true;const button=element('button',label);button.type='button';button.setAttribute('aria-controls',id);button.setAttribute('aria-expanded','false');
  let rendered=false;
  button.addEventListener('click',()=>{if(!target.hidden)context.disclosures.closeWithin(target,false);target.hidden=!target.hidden;if(!target.hidden&&!rendered){render();rendered=true;}button.textContent=target.hidden?label:hiddenLabel;button.setAttribute('aria-expanded',String(!target.hidden));});root.append(button,target);
}
export function renderProjection(root:HTMLElement,result:ProjectionResult,context:IssueViewContext):void {
  context.disclosures.closeWithin(root,false);root.replaceChildren();root.append(element('h2','Projection'),element('p',`Inputs v${result.inputRevision}`));
  if(result.years.some(year=>year.cashFlowAllocation!==undefined)){const allocation=element('div');renderAllocationYears(allocation,result.years,context);root.append(allocation);}
  const hasRsu=context.readState().savedPlan.accounts.some(account=>account.type==='rsu');
  const how=element('details');how.append(element('summary','How calculated'),element('p',hasRsu?'Annual income tax is reserved across months in proportion to positive cash income and taxable RSU compensation, or in equal monthly amounts when both are zero. Payroll taxes follow combined cumulative salary and RSU wages. Shares sold for withholding fund the modeled tax reserve; withholding is not final tax liability.':'Annual income tax is reserved across months in proportion to positive gross cash income, or in equal monthly amounts when positive income is zero. Payroll taxes follow cumulative wages.'),element('p','Asset growth changes value, not spendable cash.'));root.append(how);
  const assumptions=element('details');assumptions.append(element('summary','Forecast assumptions'),element('p',hasRsu?'Contributions remain planned when cash is insufficient. Later balances are conditional on covering the cash gap; no borrowing, discretionary sales or withdrawals are added. Sell-to-cover follows the entered percentages.':'Contributions remain planned when cash is insufficient. Later balances are conditional on covering the cash gap; no borrowing, sales or withdrawals are added.'));root.append(assumptions);
  appendCoverage(root,result.coverage);appendProvenance(root,result.provenance);
  const independent=result.rsuSchedules?.filter(schedule=>schedule.schedule.status!=='available'||result.years.find(year=>year.year===schedule.year)?.rsu?.status!=='available')??[];
  if(independent.length){const schedules=element('details');schedules.append(element('summary','Independent RSU schedules'));for(const schedule of independent){schedules.append(element('h3',`${getRecordLabel(context.readState().savedPlan,schedule.accountId)} · ${schedule.year}`));if(schedule.schedule.status==='available')rsuGrantTable(schedules,schedule.schedule.value,`independent-${schedule.year}`,context,true);else appendAmount(schedules,schedule.schedule,context,{label:'Independent RSU schedule',period:{year:schedule.year}});}root.append(schedules);}
  if(result.contributionSchedules.length){
    const details=element('details');details.append(element('summary','Contribution request schedules'));const failures=result.contributionSchedules.filter(schedule=>schedule.requests.status!=='available').length;if(failures)root.append(element('span',`${failures} contribution schedules unavailable · Open request schedules`));
    const table=element('table');table.append(element('caption','Contribution request schedules'));const head=element('thead'),header=element('tr');for(const label of ['Rule','Year','Request schedule']){const cell=element('th',label);cell.scope='col';header.append(cell);}head.append(header);table.append(head);const body=element('tbody');
    for(const schedule of result.contributionSchedules){const row=element('tr'),cell=element('td');row.append(element('th',getRecordLabel(context.readState().savedPlan,schedule.ruleId)),element('td',String(schedule.year)));cell.dataset.testid=`contribution-schedule-${schedule.year}-${schedule.ruleId}`;if(schedule.requests.status==='available')cell.textContent=`${schedule.requests.value.length} monthly requests`;else appendAmount(cell,schedule.requests,context,{label:'Contribution request schedule',period:{year:schedule.year}});row.append(cell);body.append(row);}table.append(body);details.append(table);root.append(details);
  }
  for(const year of result.years){
    const section=element('section');section.append(element('h3',String(year.year)));
    if(year.fundingStatus==='unavailable')section.append(element('p','Funding unknown'));
    else if(!year.conditionalOnGap)section.append(element('p','No modeled cash gap'));
    if(year.conditionalOnGap)section.append(element('p','Conditional: cash gap'));
    appendCoverage(section,year.coverage);movementTable(section,[year],'Annual flows and December balances',context);
    const ratios=element('dl');for(const [key,label]of [['expenseRatio','Expense / income'],['taxRatio','Tax / income'],['contributionRatio','Eligible contributions / income'],['cashFlowMargin','Cash flow / income']] as const){ratios.append(element('dt',label));const value=element('dd');appendAmount(value,year.ratios[key],context,{label,period:{year:year.year}},'ratio');ratios.append(value);}section.append(ratios);
    records(section,year,`annual-${year.year}`,context);
    const monthly=element('div'),months=result.months.filter(month=>month.year===year.year);
    expandButton(section,`Show months for ${year.year}`,`Hide months for ${year.year}`,monthly,`months-${year.year}`,()=>{movementTable(monthly,months,`Monthly flows and closing balances for ${year.year}`,context);for(const month of months)records(monthly,month,`monthly-${month.date}`,context);},context);
    const explanation=element('div');expandButton(section,`Tax explanation for ${year.year}`,`Hide tax explanation for ${year.year}`,explanation,`tax-explanation-${year.year}`,()=>renderTaxExplanation(explanation,year,context),context);
    root.append(section);
  }
  const issues=element('div');renderIssues(issues,result.issues,context);root.append(issues);
}
