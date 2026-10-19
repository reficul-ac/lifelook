import type {ScenarioViewSelections} from '../scenario-session';
import type { ProjectionSummaryRow } from '../projection-summary';
import type { ReportIssueContext } from '../issue-presentation';
import { appendAmount, element, formatCents } from './issues';

type SeriesKey=Exclude<keyof ProjectionSummaryRow,'year'>;
interface Series {key:SeriesKey;id:string;label:string;color:string;dash?:string}
const netWorth:Series={key:'netWorthCents',id:'net-worth',label:'Net Worth',color:'var(--chart-1)'};
const cashSeries:readonly Series[]=[
  {key:'totalIncomeCents',id:'total-income',label:'Total Income',color:'var(--chart-2)',dash:'8 4'},
  {key:'cashIncomeCents',id:'cash-income',label:'Cash Income',color:'var(--chart-3)',dash:'3 4'},
  {key:'postTaxIncomeCents',id:'post-tax-income',label:'Post Tax Income',color:'var(--chart-1)'},
  {key:'expensesCents',id:'expenses',label:'Expenses',color:'var(--chart-4)'},
  {key:'cashFlowCents',id:'cash-flow',label:'Cash Flow',color:'var(--chart-5)'},
];
const width=720,height=260,left=112,right=40,top=20,bottom=38;
const axisMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',minimumFractionDigits:0,maximumFractionDigits:1});
function svgElement<K extends keyof SVGElementTagNameMap>(tag:K,attributes:Record<string,string|number>={},text?:string):SVGElementTagNameMap[K] {
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,String(value));
  if(text!==undefined)node.textContent=text;
  return node;
}

export function renderForecastPlots(root:HTMLElement,rows:readonly ProjectionSummaryRow[],context:ReportIssueContext,selections?:ScenarioViewSelections,onSelectYear?:()=>void):void {
  const section=element('section');section.className='forecast-plots';
  if(!rows.length){section.append(element('p','No forecast years to plot.'));root.append(section);return;}
  const controls=element('div');controls.className='forecast-plot-controls';
  const label=element('label','Plot year'),select=element('select');select.setAttribute('aria-label','Plot year');select.dataset.reportControl='plot-year';
  for(const row of rows){const option=element('option',String(row.year));option.value=String(row.year);select.append(option);}
  label.append(select);controls.append(label);
  const help=element('small','Hover over a year, select it above, or focus a plot and use the arrow keys.');help.id='forecast-plot-help';controls.append(help);section.append(controls);
  let selected=Math.max(0,rows.findIndex(row=>row.year===selections?.forecastYear));select.value=String(rows[selected]!.year);
  const hiddenSeries=selections?.hiddenPlotSeries??new Set<SeriesKey>();
  const charts:{svg:SVGSVGElement;readout:HTMLElement;series:readonly Series[];title:string}[]=[];
  for(const [title,series,id] of [
    ['Net worth over time',[netWorth],'net-worth'],
    ['Income, expenses and cash flow',cashSeries,'cash-flow'],
  ] as const){
    const figure=element('figure');figure.className='forecast-plot';
    figure.append(element('figcaption',title));
    if(id==='cash-flow'){
      const legend=element('div');legend.className='forecast-plot-legend';legend.setAttribute('aria-label','Plot series');
      for(const line of series){
        const button=element('button');button.type='button';button.dataset.reportControl=`plot-series:${line.key}`;button.setAttribute('aria-pressed',String(!hiddenSeries.has(line.key)));button.style.setProperty('--series-color',line.color);
        const swatch=element('span');swatch.className='forecast-plot-swatch';swatch.setAttribute('aria-hidden','true');button.append(swatch,document.createTextNode(line.label));
        button.addEventListener('click',()=>{if(hiddenSeries.has(line.key))hiddenSeries.delete(line.key);else hiddenSeries.add(line.key);button.setAttribute('aria-pressed',String(!hiddenSeries.has(line.key)));paint();});
        legend.append(button);
      }
      figure.append(legend);
    }
    const svg=svgElement('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':title,'aria-describedby':help.id,tabindex:0,'data-report-control':`plot:${id}`});
    svg.classList.add('forecast-chart');
    svg.addEventListener('keydown',event=>{
      const moves:Record<string,number>={ArrowLeft:selected-1,ArrowRight:selected+1,Home:0,End:rows.length-1};
      if(event.key in moves){event.preventDefault();choose(moves[event.key]!);}
    });
    svg.addEventListener('pointermove',event=>{
      const box=svg.getBoundingClientRect();if(!box.width)return;
      const position=((event.clientX-box.left)/box.width*width-left)/(width-left-right);
      const index=Math.round(position*(rows.length-1));if(index!==selected)choose(index);
    });
    figure.append(svg);
    const readout=element('div');readout.className='forecast-plot-readout';readout.dataset.testid=`plot-${id}-readout`;figure.append(readout);
    charts.push({svg,readout,series,title});section.append(figure);
  }
  select.addEventListener('change',()=>choose(rows.findIndex(row=>String(row.year)===select.value)));
  function choose(index:number):void {const next=Math.max(0,Math.min(rows.length-1,index));if(next===selected)return;selected=next;if(selections)selections.forecastYear=rows[selected]!.year;select.value=String(rows[selected]!.year);paint();onSelectYear?.();}
  function paint():void {
    for(const chart of charts){
      const lines=chart.series.filter(series=>!hiddenSeries.has(series.key));
      const values=rows.flatMap(row=>lines.flatMap(series=>{const value=row[series.key];return value.status==='available'?[value.value]:[];}));
      const low=Math.min(0,...values),high=Math.max(0,...values);
      const span=high-low||100;
      const min=low<0?low-span*0.06:0,max=high>0?high+span*0.06:high===0&&low===0?100:0;
      const x=(index:number)=>rows.length===1?(left+width-right)/2:left+index/(rows.length-1)*(width-left-right);
      const y=(cents:number)=>top+(max-cents)/(max-min)*(height-top-bottom);
      const svg=chart.svg;svg.replaceChildren(svgElement('title',{},chart.title),svgElement('desc',{},'Annual forecast in dollars. Missing values leave gaps. Exact figures are in the readout and annual financial overview.'));
      for(let index=0;index<=4;index++){
        const value=min+(max-min)*index/4,position=y(value);
        svg.append(svgElement('line',{x1:left,y1:position,x2:width-right,y2:position,class:'forecast-grid'}),svgElement('text',{x:left-10,y:position+4,'text-anchor':'end',class:'forecast-axis'},axisMoney.format(value/100)));
      }
      if(min<0)svg.append(svgElement('line',{x1:left,y1:y(0),x2:width-right,y2:y(0),class:'forecast-zero'}));
      const yearTicks=new Set([0,Math.round((rows.length-1)/2),rows.length-1]);
      for(const index of yearTicks)svg.append(svgElement('text',{x:x(index),y:height-10,'text-anchor':'middle',class:'forecast-axis'},String(rows[index]!.year)));
      svg.append(svgElement('line',{x1:x(selected),y1:top,x2:x(selected),y2:height-bottom,class:'forecast-selected-year'}));
      for(const line of lines){
        const group=svgElement('g',{'data-series':line.id});let path='',connected=false;
        for(let index=0;index<rows.length;index++){
          const row=rows[index]!,value=row[line.key];
          if(value.status!=='available'){connected=false;continue;}
          path+=`${connected?'L':'M'}${x(index).toFixed(2)},${y(value.value).toFixed(2)} `;connected=true;
          const point=svgElement('circle',{cx:x(index),cy:y(value.value),r:index===selected?4.5:2.5,fill:line.color});
          point.append(svgElement('title',{},`${row.year} · ${line.label}: ${formatCents(value.value)}`));group.append(point);
        }
        const linePath=svgElement('path',{d:path.trim(),fill:'none',stroke:line.color,'stroke-width':2,'vector-effect':'non-scaling-stroke'});
        if(line.dash)linePath.setAttribute('stroke-dasharray',line.dash);
        group.prepend(linePath);svg.append(group);
      }
      if(!values.length)svg.append(svgElement('text',{x:(left+width-right)/2,y:height/2,'text-anchor':'middle',class:'forecast-axis'},lines.length?'No available values':'Select a series to plot'));
      context.disclosures.closeWithin(chart.readout,false);chart.readout.replaceChildren(element('p',String(rows[selected]!.year)));
      const list=element('dl');
      for(const line of lines){const entry=element('div'),value=element('dd');appendAmount(value,rows[selected]![line.key],context,{label:line.label,period:{year:rows[selected]!.year}});entry.append(element('dt',line.label),value);list.append(entry);}
      chart.readout.append(list);
    }
  }
  paint();root.append(section);
}
