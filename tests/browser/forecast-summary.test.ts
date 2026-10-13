import {describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {calculateProjection,loadRuleSet} from '../../src/engine';
import {projectionSummary,type ProjectionSummaryRow} from '../../src/browser/projection-summary';
import {renderForecastSummary} from '../../src/browser/views/forecast-summary';
import {mountPresentation} from '../helpers/presentation';
import {makePlan,mustValidate} from '../helpers/plans';

const amount=(value:number)=>({status:'available' as const,value});
const summary:ProjectionSummaryRow={
  year:2026,netWorthCents:amount(12500000),totalIncomeCents:amount(13800000),
  cashIncomeCents:amount(12000000),postTaxIncomeCents:amount(9600000),
  expensesCents:amount(7200000),cashFlowCents:amount(2400000),
};

describe('forecast summary',()=>{
  it('pairs the seven annual columns with their exact amounts in an accessible table',()=>{
    const {root,context}=mountPresentation();
    renderForecastSummary(root,[summary],context);
    const table=within(root).getByRole('table',{name:'Annual financial overview'});
    expect(within(table).getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual([
      'Year','Net Worth','Total Income','Cash Income','Post Tax Income','Expenses','Cash Flow',
    ]);
    expect(within(table).getByRole('rowheader',{name:'2026'})).toHaveAttribute('scope','row');
    for(const header of within(table).getAllByRole('columnheader'))expect(header).toHaveAttribute('scope','col');
    for(const [key,text] of [
      ['net-worth','$125,000.00'],['total-income','$138,000.00'],['cash-income','$120,000.00'],
      ['post-tax-income','$96,000.00'],['expenses','$72,000.00'],['cash-flow','$24,000.00'],
    ] as const)expect(within(table).getByTestId(`summary-2026-${key}`)).toHaveTextContent(text);
    const scroll=within(root).getByRole('region',{name:'Annual financial overview, horizontally scrollable'});
    expect(scroll).toHaveClass('forecast-summary-wrap');
    expect(scroll).toHaveAttribute('tabindex','0');
  });

  it('preserves negative cash flow and gives positive and negative flows separate styling',()=>{
    const {root,context}=mountPresentation();
    renderForecastSummary(root,[summary,{...summary,year:2027,cashFlowCents:amount(-2500000)}],context);
    expect(within(root).getByTestId('summary-2026-cash-flow')).toHaveClass('cash-flow-positive');
    const deficit=within(root).getByTestId('summary-2027-cash-flow');
    expect(deficit).toHaveTextContent('-$25,000.00');
    expect(deficit).toHaveClass('cash-flow-negative');
    expect(deficit).not.toHaveClass('cash-flow-positive');
  });

  it('keeps independent amounts available and opens the existing missing-tax disclosure',()=>{
    const base=makePlan({
      otherIncome:[{id:'cash-other',name:'Other income',amountCents:100000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,classification:'non-taxable'}],
      expenses:[{id:'living',name:'Living costs',amountCents:25000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'personal'}],
    });
    const plan={...base,household:{...base.household,coverageAnswers:{...base.household.coverageAnswers,additionalIncome:{known:false as const}}}};
    const {root,context,reviews}=mountPresentation(plan);
    const projection=calculateProjection(mustValidate(plan),loadRuleSet());
    renderForecastSummary(root,projection.years.map(projectionSummary),context);
    expect(within(root).getByTestId('summary-2026-total-income')).toHaveTextContent('$12,000.00');
    expect(within(root).getByTestId('summary-2026-cash-income')).toHaveTextContent('$12,000.00');
    expect(within(root).getByTestId('summary-2026-expenses')).toHaveTextContent('$3,000.00');
    const postTax=within(root).getByTestId('summary-2026-post-tax-income');
    expect(postTax).toHaveTextContent('Needs data');
    expect(postTax).not.toHaveTextContent('$0.00');
    fireEvent.click(within(postTax).getByRole('button',{name:'Needs data: Post Tax Income · 2026'}));
    const panel=within(document.body).getByRole('region',{name:'Post Tax Income · 2026'});
    expect(panel).toHaveTextContent('Additional income outside these records');
    fireEvent.click(within(panel).getByRole('button',{name:'Review Household'}));
    expect(reviews).toContainEqual(expect.objectContaining({section:'Household',recordId:'household'}));
  });

  it('appends its section while preserving projection content managed by the parent renderer',()=>{
    const {root,context}=mountPresentation();
    const existing=document.createElement('h2');existing.textContent='Projection';root.append(existing);
    renderForecastSummary(root,[summary],context);
    expect(root.firstElementChild).toBe(existing);
    expect(within(root).getAllByRole('table',{name:'Annual financial overview'})).toHaveLength(1);
  });
});
