import { describe, expect, it } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import type { ProjectionSummaryRow } from '../../src/browser/projection-summary';
import { renderForecastPlots } from '../../src/browser/views/forecast-plots';
import { mountPresentation } from '../helpers/presentation';

const available=(value:number)=>({status:'available' as const,value});
function row(year:number,netWorth:number):ProjectionSummaryRow {
  return {year,netWorthCents:available(netWorth),totalIncomeCents:available(14000000),cashIncomeCents:available(12000000),postTaxIncomeCents:available(9000000),expensesCents:available(6000000),cashFlowCents:available(3000000)};
}

describe('interactive annual forecast plots',()=>{
  it('updates both plot readouts with the selected year and keyboard navigation',()=>{
    const {root,context}=mountPresentation();
    renderForecastPlots(root,[row(2026,10000000),{...row(2027,15000000),cashFlowCents:available(-2000000)},row(2028,20000000)],context);
    const queries=within(root),select=queries.getByLabelText('Plot year');
    expect(queries.getByRole('img',{name:'Net worth over time'})).toBeVisible();
    expect(queries.getByRole('img',{name:'Income, expenses and cash flow'})).toBeVisible();
    expect(queries.getByTestId('plot-net-worth-readout')).toHaveTextContent('$100,000.00');
    fireEvent.change(select,{target:{value:'2028'}});
    expect(queries.getByTestId('plot-net-worth-readout')).toHaveTextContent('$200,000.00');
    expect(queries.getByTestId('plot-cash-flow-readout')).toHaveTextContent('2028');
    fireEvent.keyDown(queries.getByRole('img',{name:'Net worth over time'}),{key:'ArrowLeft'});
    expect(select).toHaveValue('2027');
    expect(queries.getByTestId('plot-net-worth-readout')).toHaveTextContent('$150,000.00');
    expect(queries.getByTestId('plot-cash-flow-readout')).toHaveTextContent('-$20,000.00');
  });
  it('lets a legend toggle hide a series and restore its plotted values',()=>{
    const {root,context}=mountPresentation();renderForecastPlots(root,[row(2026,10000000),row(2027,15000000)],context);
    const chart=within(root).getByRole('img',{name:'Income, expenses and cash flow'});
    const toggle=within(root).getByRole('button',{name:/^Total Income$/});
    expect(chart.querySelector('[data-series="total-income"]')).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed','false');
    expect(chart.querySelector('[data-series="total-income"]')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed','true');
    expect(chart.querySelector('[data-series="total-income"]')).not.toBeNull();
  });
  it('leaves a gap for missing values and preserves the disclosure in the readout',()=>{
    const {root,context}=mountPresentation();
    const issue={code:'required-history',year:2027,severity:'warning' as const,field:'openingBalance',explanation:'The balance history is missing.',resolution:'Confirm the balance.'};
    renderForecastPlots(root,[row(2026,10000000),{...row(2027,15000000),netWorthCents:{status:'needs-data',issues:[issue]}},row(2028,20000000)],context);
    const chart=within(root).getByRole('img',{name:'Net worth over time'});
    const path=chart.querySelector('[data-series="net-worth"] path')!;
    expect(path.getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(chart.querySelectorAll('[data-series="net-worth"] circle')).toHaveLength(2);
    fireEvent.change(within(root).getByLabelText('Plot year'),{target:{value:'2027'}});
    const readout=within(root).getByTestId('plot-net-worth-readout');
    fireEvent.click(within(readout).getByRole('button',{name:/Needs data/}));
    expect(within(document.body).getByRole('region',{name:'Net Worth · 2027'})).toHaveTextContent('The balance history is missing.');
    expect(within(root).getByTestId('plot-cash-flow-readout')).toHaveTextContent('$30,000.00');
  });
  it.each([0,-10000000])('plots a single zero or negative year without invalid coordinates (%i)',netWorth=>{
    const {root,context}=mountPresentation();renderForecastPlots(root,[row(2026,netWorth)],context);
    const chart=within(root).getByRole('img',{name:'Net worth over time'});
    const point=chart.querySelector('[data-series="net-worth"] circle')!;
    expect(Number.isFinite(Number(point.getAttribute('cx')))).toBe(true);
    expect(Number.isFinite(Number(point.getAttribute('cy')))).toBe(true);
    expect(chart.outerHTML).not.toMatch(/NaN|Infinity/);
    expect(within(root).getByTestId('plot-net-worth-readout')).toHaveTextContent(netWorth===0?'$0.00':'-$100,000.00');
  });
  it('handles an empty forecast without constructing a misleading chart',()=>{
    const {root,context}=mountPresentation();renderForecastPlots(root,[],context);
    expect(within(root).getByText('No forecast years to plot.')).toBeVisible();
    expect(within(root).queryByRole('img')).toBeNull();
  });
});

import {createEditorViewSession} from '../../src/browser/scenario-session';
import {makePlan} from '../helpers/plans';
it('retains actual plot years and hidden series independently across rendering',()=>{
 const {root,context}=mountPresentation(),view=createEditorViewSession(makePlan({horizonYears:2}));renderForecastPlots(root,[row(2026,10000),row(2027,20000)],context,view.selections);
 fireEvent.change(within(root).getByLabelText('Plot year'),{target:{value:'2027'}});fireEvent.click(within(root).getByRole('button',{name:'Cash Flow'}));expect(view.selections.forecastYear).toBe(2027);expect(view.selections.hiddenPlotSeries.has('cashFlowCents')).toBe(true);
 root.replaceChildren();renderForecastPlots(root,[row(2026,10000),row(2027,20000)],context,view.selections);expect(within(root).getByLabelText('Plot year')).toHaveValue('2027');expect(within(root).getByRole('button',{name:'Cash Flow'})).toHaveAttribute('aria-pressed','false');
 const other=createEditorViewSession(makePlan());expect(other.selections.forecastYear).toBe(2026);expect(other.selections.hiddenPlotSeries.size).toBe(0);
});
