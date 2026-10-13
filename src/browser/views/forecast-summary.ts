import type {IssueViewContext} from '../issue-presentation';
import type {ProjectionSummaryRow} from '../projection-summary';
import {appendAmount,element} from './issues';

const columns:readonly {key:Exclude<keyof ProjectionSummaryRow,'year'>;label:string;slug:string}[]=[
  {key:'netWorthCents',label:'Net Worth',slug:'net-worth'},
  {key:'totalIncomeCents',label:'Total Income',slug:'total-income'},
  {key:'cashIncomeCents',label:'Cash Income',slug:'cash-income'},
  {key:'postTaxIncomeCents',label:'Post Tax Income',slug:'post-tax-income'},
  {key:'expensesCents',label:'Expenses',slug:'expenses'},
  {key:'cashFlowCents',label:'Cash Flow',slug:'cash-flow'},
];

export function renderForecastSummary(root:HTMLElement,rows:readonly ProjectionSummaryRow[],context:IssueViewContext):void {
  const section=element('section');section.className='forecast-summary';
  const scroll=element('div');scroll.className='forecast-summary-wrap';scroll.tabIndex=0;
  scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Annual financial overview, horizontally scrollable');
  const table=element('table');table.append(element('caption','Annual financial overview'));
  const head=element('thead'),header=element('tr'),yearHeader=element('th','Year');
  yearHeader.scope='col';header.append(yearHeader);
  for(const column of columns){const cell=element('th',column.label);cell.scope='col';header.append(cell);}
  head.append(header);table.append(head);
  const body=element('tbody');
  for(const row of rows){
    const line=element('tr'),year=element('th',String(row.year));year.scope='row';line.append(year);
    for(const column of columns){
      const cell=element('td'),value=row[column.key];cell.dataset.testid=`summary-${row.year}-${column.slug}`;
      if(column.key==='cashFlowCents'&&value.status==='available')cell.className=value.value<0?'cash-flow-negative':value.value>0?'cash-flow-positive':'cash-flow-neutral';
      appendAmount(cell,value,context,{label:column.label,period:{year:row.year}});line.append(cell);
    }
    body.append(line);
  }
  table.append(body);scroll.append(table);section.append(scroll,element('small','Year-end net worth. Cash Flow is the amount available before investment contributions.'));
  const definitions=element('details');definitions.append(
    element('summary','About these figures'),
    element('p','Total Income includes cash income and vested RSUs. Cash Income includes salaries, rent and other cash income, with retained RSU shares excluded.'),
    element('p','Post Tax Income subtracts modeled taxes from cash income and credits RSU share withholding that funds those taxes. Expenses include ordinary and property costs plus full mortgage and debt payments. Investment contributions are savings, so Cash Flow shows Post Tax Income minus Expenses before those transfers.'),
  );section.append(definitions);root.append(section);
}
