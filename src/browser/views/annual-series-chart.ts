import type {Available,Cents} from '../../engine';
import {mountSwitchControl} from '../ui/switch-control';
import {element,formatCents} from './issues';
import '../styles/growth-chart.css';

export type AnnualChartWindow=5|10|15|'all';
export interface AnnualSeriesChartPoint {readonly year:number;readonly values:Readonly<Record<string,Available<Cents>>>;readonly note?:string}
export interface AnnualSeriesChartModel {
 readonly title:string;readonly ariaLabel:string;readonly help:string;readonly description:string;readonly xAxisLabel:string;readonly yearLabel:string;readonly windowLabel:string;readonly comparisonLabel:string;readonly emptyLabel:string;readonly sourceLabel:string;
 readonly availableYears:readonly number[];readonly selectedYear:number;readonly window:AnnualChartWindow;readonly availableWindows:readonly AnnualChartWindow[];readonly showComparison:boolean;readonly canCompare:boolean;readonly status:'complete'|'pending';
 readonly series:readonly {readonly id:string;readonly label:string;readonly lineStyle:'solid'|'dashed'}[];readonly points:readonly AnnualSeriesChartPoint[];
}
export interface AnnualSeriesChartOptions {onSelectYear(year:number):void;onWindowChange(window:AnnualChartWindow):void;onComparisonChange(show:boolean):void;renderReadout?(root:HTMLElement,point:AnnualSeriesChartPoint,isCurrent:()=>boolean):void;clearReadout?(root:HTMLElement):void}
const height=280,top=20,bottom=38;
const compactMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1});
let sequence=0;
function svgNode<K extends keyof SVGElementTagNameMap>(tag:K,attributes:Record<string,string|number>={},text?:string):SVGElementTagNameMap[K] {
 const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
 if(text!==undefined)node.textContent=text;return node;
}
const fingerprint=(model:AnnualSeriesChartModel)=>JSON.stringify([model.series.map(s=>s.id),model.points.map(point=>[point.year,...model.series.map(s=>point.values[s.id])])]);

export function mountAnnualSeriesChart(root:HTMLElement,initial:AnnualSeriesChartModel,options:AnnualSeriesChartOptions):{update(model:AnnualSeriesChartModel):void;dispose():void} {
 let model=initial,selectedWindow=initial.window,showComparison=initial.showComparison,selectedYear=initial.selectedYear,disposed=false,generation=0,width=Math.max(240,root.getBoundingClientRect().width||640);
 let frame:number|undefined,ghosts:SVGPathElement[]=[];
 let geometry:{x:(year:number)=>number;y:(value:number)=>number;left:number;right:number}={x:()=>0,y:()=>0,left:0,right:0};
 const section=element('section');section.className='growth-chart annual-series-chart';section.dataset.animation='none';
 const heading=element('h2',model.title),source=element('p');source.className='growth-chart-source';
 const controls=element('div');controls.className='growth-chart-controls';
 const horizons=element('div');horizons.className='growth-chart-horizons';horizons.setAttribute('role','group');horizons.setAttribute('aria-label',model.windowLabel);
 const horizonButtons=new Map<AnnualChartWindow,HTMLButtonElement>();
 const listenerRemovers:(()=>void)[]=[];
 function listen<K extends keyof SVGElementEventMap>(node:SVGSVGElement,type:K,listener:(event:SVGElementEventMap[K])=>void):void {
  node.addEventListener(type,listener as EventListener);listenerRemovers.push(()=>node.removeEventListener(type,listener as EventListener));
 }
 for(const horizon of [5,10,15,'all'] as const){
  const button=element('button',horizon==='all'?'All':`${horizon}Y`);button.type='button';button.setAttribute('aria-pressed','false');
  const activate=()=>{if(disposed||button.hidden||selectedWindow===horizon)return;selectedWindow=horizon;syncControls();options.onWindowChange(horizon);};
  button.addEventListener('click',activate);listenerRemovers.push(()=>button.removeEventListener('click',activate));
  horizonButtons.set(horizon,button);horizons.append(button);
 }
 const yearLabel=element('label',model.yearLabel),yearSelect=element('select');yearSelect.setAttribute('aria-label',model.yearLabel);yearLabel.append(yearSelect);
 const switchHost=element('div');
 const comparisonSwitch=mountSwitchControl(switchHost,{label:model.comparisonLabel,field:'annual-series-comparison',checked:showComparison,onChange(checked){if(disposed)return;showComparison=checked;options.onComparisonChange(checked);syncControls();paintSelection();}});
 controls.append(horizons,yearLabel,switchHost);
 const help=element('p',model.help);help.id=`growth-chart-help-${++sequence}`;help.className='growth-chart-help';
 const chart=svgNode('svg',{role:'img','aria-label':model.ariaLabel,'aria-describedby':help.id,tabindex:0});chart.classList.add('growth-chart-svg');
 const title=svgNode('title',{},model.title),description=svgNode('desc',{},model.description);chart.append(title,description);
 const axes=svgNode('g',{'aria-hidden':'true'}),zero=svgNode('line',{class:'growth-chart-zero'});
 const seriesNodes=new Map<string,{group:SVGGElement;path:SVGPathElement;dot:SVGCircleElement;label:HTMLSpanElement}>();
 const crosshair=svgNode('line',{class:'growth-chart-crosshair',y1:top,y2:height-bottom});
 chart.append(axes,zero,crosshair);
 const legend=element('div');legend.className='growth-chart-legend';
 const readout=element('div');readout.className='growth-chart-readout';
 const live=element('span');live.className='growth-chart-announcement';live.setAttribute('role','status');live.setAttribute('aria-live','polite');live.setAttribute('aria-atomic','true');
 const empty=element('p',model.emptyLabel);empty.hidden=true;
 const axisLabel=element('p',model.xAxisLabel);axisLabel.className='annual-series-axis-label';axisLabel.hidden=!model.xAxisLabel;
 section.append(heading,source,controls,help,chart,axisLabel,legend,readout,empty,live);root.append(section);

 function syncControls():void {
  for(const [horizon,button]of horizonButtons){button.hidden=!model.availableWindows.includes(horizon);button.setAttribute('aria-pressed',String(selectedWindow===horizon));}
  switchHost.hidden=!model.comparisonLabel;const caption=switchHost.querySelector('label > span');if(caption)caption.textContent=model.comparisonLabel;comparisonSwitch.input.dataset.fieldLabel=model.comparisonLabel;comparisonSwitch.update(showComparison);comparisonSwitch.input.disabled=!model.canCompare;
  for(const series of model.series){const node=seriesNodes.get(series.id)!;node.group.setAttribute('visibility',series.lineStyle==='solid'||model.canCompare&&showComparison?'visible':'hidden');node.label.hidden=series.lineStyle==='dashed'&&(!model.canCompare||!showComparison);}
 }
 function syncModelControls():void {
  selectedWindow=model.window;showComparison=model.showComparison;heading.textContent=model.title;source.textContent=model.sourceLabel;help.textContent=model.help;title.textContent=model.title;description.textContent=model.description;chart.setAttribute('aria-label',model.ariaLabel);horizons.setAttribute('aria-label',model.windowLabel);yearSelect.setAttribute('aria-label',model.yearLabel);axisLabel.textContent=model.xAxisLabel;axisLabel.hidden=!model.xAxisLabel;empty.textContent=model.emptyLabel;
  for(const [id,node]of seriesNodes)if(!model.series.some(s=>s.id===id)){node.group.remove();node.label.remove();seriesNodes.delete(id);}
  for(const series of [...model.series].reverse()){
   let node=seriesNodes.get(series.id);if(!node){const group=svgNode('g',{'data-series':series.id}),path=svgNode('path',{fill:'none','vector-effect':'non-scaling-stroke'}),dot=svgNode('circle',{r:4}),label=element('span');group.append(path,dot);chart.insertBefore(group,crosshair);node={group,path,dot,label};seriesNodes.set(series.id,node);}
   const variant=series.lineStyle==='dashed'?'applied':'producing';node.path.setAttribute('class',`growth-chart-${variant}`);node.dot.setAttribute('class',`growth-chart-${variant}-dot`);node.label.className=`growth-chart-${variant}-label`;node.label.textContent=series.label;if(series.lineStyle==='dashed')node.path.setAttribute('stroke-dasharray','7 5');else node.path.removeAttribute('stroke-dasharray');
  }
  for(const series of model.series)legend.append(seriesNodes.get(series.id)!.label);
  const years=model.availableYears.map(String);if(years.join(',')!==[...yearSelect.options].map(option=>option.value).join(','))yearSelect.replaceChildren(...years.map(year=>{const option=element('option',year);option.value=year;return option;}));
  yearSelect.disabled=!model.points.length;chart.style.display=model.points.length?'':'none';legend.hidden=!model.points.length;empty.hidden=!!model.points.length;syncControls();
 }
 function cancelAnimation():void {
  if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;
  for(const ghost of ghosts)ghost.remove();ghosts=[];
  for(const node of seriesNodes.values())node.path.style.opacity='';section.dataset.animation='none';
 }
 function pathsForCurrentGeometry():readonly string[] {
  return model.series.map(series=>{
   let path='',previous:number|undefined;
   for(const point of model.points){const amount=point.values[series.id];if(!amount||amount.status!=='available'){previous=undefined;continue;}
    path+=`${previous===point.year-1?'L':'M'}${geometry.x(point.year).toFixed(2)},${geometry.y(amount.value).toFixed(2)} `;previous=point.year;
   }return path.trim();
  });
 }
 function paintGeometry(animate:boolean):void {
  cancelAnimation();chart.setAttribute('viewBox',`0 0 ${width} ${height}`);
  const left=width<400?66:88,right=18;
  const values=model.points.flatMap(point=>model.series.flatMap(series=>{const value=point.values[series.id];return value?.status==='available'?[value.value]:[];}));
  const low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||100,min=low<0?low-span*.06:0,max=high>0?high+span*.06:low===0?100:0;
  const first=model.points[0]?.year??selectedYear,last=model.points[model.points.length-1]?.year??first;
  geometry={left,right,x:year=>first===last?(left+width-right)/2:left+(year-first)/(last-first)*(width-left-right),y:value=>top+(max-value)/(max-min)*(height-top-bottom)};
  axes.replaceChildren();
  for(let tick=0;tick<=4;tick++){
   const value=min+(max-min)*tick/4,y=geometry.y(value);
   axes.append(svgNode('line',{x1:left,x2:width-right,y1:y,y2:y,class:'growth-chart-grid'}),svgNode('text',{x:left-8,y:y+4,'text-anchor':'end',class:'growth-chart-axis'},compactMoney.format(value/100)));
  }
  const indices=new Set([0,Math.floor((model.points.length-1)/2),model.points.length-1]);
  for(const index of indices){const point=model.points[index];if(point)axes.append(svgNode('text',{x:geometry.x(point.year),y:height-10,'text-anchor':'middle',class:'growth-chart-axis'},String(point.year)));}
  for(const [key,value] of Object.entries({x1:left,x2:width-right,y1:geometry.y(0),y2:geometry.y(0)}))zero.setAttribute(key,String(value));
  const paths=model.series.map(s=>seriesNodes.get(s.id)!.path),next=pathsForCurrentGeometry(),previous=paths.map(path=>path.getAttribute('d')??'');
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!animate||reduced||!previous.some(Boolean)||previous.every((value,index)=>value===next[index])){paths.forEach((path,index)=>path.setAttribute('d',next[index]!));return;}
  const sameTopology=previous.every((value,index)=>value.replace(/[-\d.]+/g,'')===next[index]!.replace(/[-\d.]+/g,''));
  section.dataset.animation=sameTopology?'morph':'crossfade';
  if(!sameTopology){
   paths.forEach((path,index)=>{
    if(previous[index]){const ghost=path.cloneNode(false) as SVGPathElement;ghost.classList.add('growth-chart-ghost');ghost.setAttribute('aria-hidden','true');path.before(ghost);ghosts.push(ghost);}
    path.setAttribute('d',next[index]!);path.style.opacity='0';
   });
  }
  const from=previous.map(value=>(value.match(/-?\d+(?:\.\d+)?/g)??[]).map(Number));let started:number|undefined;
  const step=(time:number)=>{
   if(disposed)return;started??=time;const fraction=Math.min(1,(time-started)/180);
   if(sameTopology)paths.forEach((path,index)=>{let cursor=0;path.setAttribute('d',next[index]!.replace(/-?\d+(?:\.\d+)?/g,value=>{const origin=from[index]![cursor++]!;return (origin+(Number(value)-origin)*fraction).toFixed(2);}));});
   else {paths.forEach(path=>path.style.opacity=String(fraction));ghosts.forEach(ghost=>ghost.style.opacity=String(1-fraction));}
   if(fraction<1)frame=requestAnimationFrame(step);
   else {frame=undefined;cancelAnimation();paths.forEach((path,index)=>path.setAttribute('d',next[index]!));}
  };frame=requestAnimationFrame(step);
 }
 function paintSelection():void {
  generation++;options.clearReadout?.(readout);readout.replaceChildren();const point=model.points.find(point=>point.year===selectedYear);yearSelect.value=String(selectedYear);
  if(!point){crosshair.setAttribute('visibility','hidden');for(const node of seriesNodes.values())node.dot.setAttribute('visibility','hidden');return;}
  crosshair.setAttribute('visibility','visible');crosshair.setAttribute('x1',String(geometry.x(point.year)));crosshair.setAttribute('x2',String(geometry.x(point.year)));
  for(const series of model.series){const dot=seriesNodes.get(series.id)!.dot,value=point.values[series.id];dot.setAttribute('visibility',value?.status==='available'&&(series.lineStyle==='solid'||model.canCompare&&showComparison)?'visible':'hidden');if(value?.status==='available'){dot.setAttribute('cx',String(geometry.x(point.year)));dot.setAttribute('cy',String(geometry.y(value.value)));}}
  const selectedGeneration=generation,isCurrent=()=>!disposed&&generation===selectedGeneration;
  if(options.renderReadout){options.renderReadout(readout,point,isCurrent);return;}
  const list=element('dl');for(const series of model.series){if(series.lineStyle==='dashed'&&(!model.canCompare||!showComparison))continue;const row=element('div'),value=point.values[series.id];row.append(element('dt',`${series.label} · ${point.year}`),element('dd',value?.status==='available'?formatCents(value.value):value?.status==='unsupported-case'?'Unsupported':'Needs data'));list.append(row);}readout.append(list);if(point.note)readout.append(element('p',point.note));
 }
 function announce():void {const point=model.points.find(point=>point.year===selectedYear),value=point?.values[model.series[0]?.id??''];if(point)live.textContent=`${point.year}: ${value?.status==='available'?formatCents(value.value):value?.status==='unsupported-case'?'Unsupported':'Needs data'}. ${model.sourceLabel}${point.note?` · ${point.note}`:''}`;}
 function choose(year:number,committed:boolean):void {
  if(disposed||!model.points.length)return;
  const point=model.points.reduce((best,point)=>Math.abs(point.year-year)<Math.abs(best.year-year)?point:best,model.points[0]!);
  if(selectedYear!==point.year){selectedYear=point.year;paintSelection();options.onSelectYear(selectedYear);}
  if(committed)announce();
 }
 const selectYear=()=>choose(Number(yearSelect.value),true);yearSelect.addEventListener('change',selectYear);listenerRemovers.push(()=>yearSelect.removeEventListener('change',selectYear));
 listen(chart,'keydown',event=>{
  const index=model.points.findIndex(point=>point.year===selectedYear),moves:Record<string,number>={ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:model.points.length-1};
  if(event.key in moves){event.preventDefault();const point=model.points[Math.max(0,Math.min(model.points.length-1,moves[event.key]!))];if(point)choose(point.year,true);}
 });
 const scrub=(event:PointerEvent)=>{
  if(disposed||!Number.isFinite(event.clientX)||!model.points.length)return;
  const box=chart.getBoundingClientRect();if(!box.width)return;
  const ratio=Math.max(0,Math.min(1,((event.clientX-box.left)/box.width*width-geometry.left)/(width-geometry.left-geometry.right)));
  const first=model.points[0]!.year,last=model.points[model.points.length-1]!.year;choose(Math.round(first+ratio*(last-first)),false);
 };
 listen(chart,'pointermove',scrub);listen(chart,'pointerdown',scrub);listen(chart,'pointerup',()=>{if(!disposed)announce();});
 const resize=(nextWidth:number)=>{if(disposed||nextWidth<=0||nextWidth===width)return;width=Math.max(240,nextWidth);paintGeometry(false);paintSelection();};
 const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(entries=>{const entry=entries[0];if(entry)resize(entry.contentRect.width);});observer?.observe(section);
 const windowResize=()=>resize(section.getBoundingClientRect().width);if(!observer)window.addEventListener('resize',windowResize);
 syncModelControls();paintGeometry(false);paintSelection();
 return {
  update(next){if(disposed)return;const changed=fingerprint(model)!==fingerprint(next),completed=next.status==='complete';model=next;selectedYear=next.selectedYear;syncModelControls();if(changed||(!completed&&frame!==undefined))paintGeometry(completed);paintSelection();},
  dispose(){if(disposed)return;disposed=true;generation++;cancelAnimation();observer?.disconnect();window.removeEventListener('resize',windowResize);comparisonSwitch.dispose();listenerRemovers.forEach(remove=>remove());options.clearReadout?.(readout);},
 };
}
