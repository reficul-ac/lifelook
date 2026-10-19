import type {Available,Cents} from '../../engine';
import type {GrowthChartModel,GrowthChartViewState} from '../growth-chart-model';
import type {ReportIssueContext} from '../issue-presentation';
import {mountSwitchControl} from '../ui/switch-control';
import {appendAmount,element,formatCents} from './issues';
import '../styles/growth-chart.css';

const height=280,top=20,bottom=38;
const compactMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1});
let sequence=0;
function svgNode<K extends keyof SVGElementTagNameMap>(tag:K,attributes:Record<string,string|number>={},text?:string):SVGElementTagNameMap[K] {
 const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
 if(text!==undefined)node.textContent=text;return node;
}
const fingerprint=(model:GrowthChartModel)=>JSON.stringify(model.points.map(point=>[point.year,point.netWorth,point.appliedNetWorth]));

export function mountGrowthChart(root:HTMLElement,initial:GrowthChartModel,options:{view:GrowthChartViewState;context:ReportIssueContext;onSelectYear(year:number):void;onViewChange():void}):{update(model:GrowthChartModel,context:ReportIssueContext):void;dispose():void} {
 let model=initial,context=options.context,selectedYear=initial.selectedYear,disposed=false,generation=0,width=Math.max(240,root.getBoundingClientRect().width||640);
 let frame:number|undefined,ghosts:SVGPathElement[]=[];
 let geometry:{x:(year:number)=>number;y:(value:number)=>number;left:number;right:number}={x:()=>0,y:()=>0,left:0,right:0};
 const section=element('section');section.className='growth-chart';section.dataset.animation='none';
 const heading=element('h2','Net worth over time'),source=element('p');source.className='growth-chart-source';
 const controls=element('div');controls.className='growth-chart-controls';
 const horizons=element('div');horizons.className='growth-chart-horizons';horizons.setAttribute('role','group');horizons.setAttribute('aria-label','Forecast window');
 const horizonButtons=new Map<GrowthChartModel['horizon'],HTMLButtonElement>();
 const listenerRemovers:(()=>void)[]=[];
 function listen<K extends keyof SVGElementEventMap>(node:SVGSVGElement,type:K,listener:(event:SVGElementEventMap[K])=>void):void {
  node.addEventListener(type,listener as EventListener);listenerRemovers.push(()=>node.removeEventListener(type,listener as EventListener));
 }
 for(const horizon of [5,10,15,'all'] as const){
  const button=element('button',horizon==='all'?'All':`${horizon}Y`);button.type='button';button.setAttribute('aria-pressed','false');
  const activate=()=>{if(disposed||button.hidden||options.view.horizon===horizon)return;options.view.horizon=horizon;syncControls();options.onViewChange();};
  button.addEventListener('click',activate);listenerRemovers.push(()=>button.removeEventListener('click',activate));
  horizonButtons.set(horizon,button);horizons.append(button);
 }
 const yearLabel=element('label','Chart year'),yearSelect=element('select');yearSelect.setAttribute('aria-label','Chart year');yearLabel.append(yearSelect);
 const switchHost=element('div');
 const comparisonSwitch=mountSwitchControl(switchHost,{label:'Show applied plan',field:'growth-chart-comparison',checked:options.view.showComparison,onChange(checked){if(disposed)return;options.view.showComparison=checked;syncControls();paintSelection();options.onViewChange();}});
 controls.append(horizons,yearLabel,switchHost);
 const help=element('p','Annual year-end forecast. Hover or drag to inspect a year, or use the year selector and Arrow, Home or End keys.');help.id=`growth-chart-help-${++sequence}`;help.className='growth-chart-help';
 const chart=svgNode('svg',{role:'img','aria-label':'Net worth over time','aria-describedby':help.id,tabindex:0});chart.classList.add('growth-chart-svg');
 chart.append(svgNode('title',{},'Net worth over time'),svgNode('desc',{},'Annual year-end projections in dollars. Solid line: producing plan. Dashed line: applied plan. Missing values leave gaps; exact values and explanations are below.'));
 const axes=svgNode('g',{'aria-hidden':'true'}),zero=svgNode('line',{class:'growth-chart-zero'});
 const producing=svgNode('g',{'data-series':'producing'}),applied=svgNode('g',{'data-series':'applied'});
 const producingPath=svgNode('path',{fill:'none',class:'growth-chart-producing','vector-effect':'non-scaling-stroke'}),appliedPath=svgNode('path',{fill:'none',class:'growth-chart-applied','stroke-dasharray':'7 5','vector-effect':'non-scaling-stroke'});
 const producingDot=svgNode('circle',{r:4,class:'growth-chart-producing-dot'}),appliedDot=svgNode('circle',{r:4,class:'growth-chart-applied-dot'});
 producing.append(producingPath,producingDot);applied.append(appliedPath,appliedDot);
 const crosshair=svgNode('line',{class:'growth-chart-crosshair',y1:top,y2:height-bottom});
 chart.append(axes,zero,applied,producing,crosshair);
 const legend=element('div');legend.className='growth-chart-legend';
 const producingLabel=element('span'),appliedLabel=element('span','Applied plan');producingLabel.className='growth-chart-producing-label';appliedLabel.className='growth-chart-applied-label';legend.append(producingLabel,appliedLabel);
 const readout=element('div');readout.className='growth-chart-readout';
 const live=element('span');live.className='growth-chart-announcement';live.setAttribute('role','status');live.setAttribute('aria-live','polite');live.setAttribute('aria-atomic','true');
 const empty=element('p','No forecast years to plot.');empty.hidden=true;
 section.append(heading,source,controls,help,chart,legend,readout,empty,live);root.append(section);

 function syncControls():void {
  for(const [horizon,button] of horizonButtons){button.hidden=!model.availableHorizons.includes(horizon);button.setAttribute('aria-pressed',String(options.view.horizon===horizon));}
  comparisonSwitch.update(options.view.showComparison);comparisonSwitch.input.disabled=!model.canCompare;
  applied.setAttribute('visibility',model.canCompare&&options.view.showComparison?'visible':'hidden');
  appliedLabel.hidden=!model.canCompare||!options.view.showComparison;
 }
 function syncModelControls():void {
  options.view.horizon=model.horizon;source.textContent=model.sourceLabel;
  producingLabel.textContent=model.status==='preview'?'Preview plan':model.status==='applied'?'Applied plan':'Producing plan';
  const years=model.points.map(point=>String(point.year));
  if(years.join(',')!==[...yearSelect.options].map(option=>option.value).join(','))yearSelect.replaceChildren(...years.map(year=>{const option=element('option',year);option.value=year;return option;}));
  yearSelect.disabled=!model.points.length;chart.style.display=model.points.length?'':'none';legend.hidden=!model.points.length;empty.hidden=!!model.points.length;
  syncControls();
 }
 function cancelAnimation():void {
  if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;
  for(const ghost of ghosts)ghost.remove();ghosts=[];
  producingPath.style.opacity='';appliedPath.style.opacity='';section.dataset.animation='none';
 }
 function pathsForCurrentGeometry():readonly string[] {
  return (['netWorth','appliedNetWorth'] as const).map(key=>{
   let path='',previous:number|undefined;
   for(const point of model.points){const amount=point[key];if(!amount||amount.status!=='available'){previous=undefined;continue;}
    path+=`${previous===point.year-1?'L':'M'}${geometry.x(point.year).toFixed(2)},${geometry.y(amount.value).toFixed(2)} `;previous=point.year;
   }return path.trim();
  });
 }
 function paintGeometry(animate:boolean):void {
  cancelAnimation();chart.setAttribute('viewBox',`0 0 ${width} ${height}`);
  const left=width<400?66:88,right=18;
  const values=model.points.flatMap(point=>[point.netWorth,point.appliedNetWorth].flatMap(value=>value?.status==='available'?[value.value]:[]));
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
  const paths=[producingPath,appliedPath],next=pathsForCurrentGeometry(),previous=paths.map(path=>path.getAttribute('d')??'');
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
  generation++;context.disclosures.closeWithin(readout,false);readout.replaceChildren();
  const point=model.points.find(point=>point.year===selectedYear);yearSelect.value=String(selectedYear);
  if(!point){crosshair.setAttribute('visibility','hidden');producingDot.setAttribute('visibility','hidden');appliedDot.setAttribute('visibility','hidden');return;}
  crosshair.setAttribute('visibility','visible');crosshair.setAttribute('x1',String(geometry.x(point.year)));crosshair.setAttribute('x2',String(geometry.x(point.year)));
  for(const [dot,value] of [[producingDot,point.netWorth],[appliedDot,point.appliedNetWorth]] as const){dot.setAttribute('visibility',value?.status==='available'&&(dot!==appliedDot||model.canCompare&&options.view.showComparison)?'visible':'hidden');if(value?.status==='available'){dot.setAttribute('cx',String(geometry.x(point.year)));dot.setAttribute('cy',String(geometry.y(value.value)));}}
  const currentGeneration=generation,currentContext=context;
  const guarded:ReportIssueContext={...currentContext,review:target=>{if(!disposed&&generation===currentGeneration)currentContext.review(target);}};
  const list=element('dl');
  function entry(label:string,value:Available<Cents>,signed=false):void {
   const row=element('div'),amount=element('dd');row.append(element('dt',label),amount);
   if(signed&&value.status==='available')amount.textContent=`${value.value>=0?'+':'−'}${formatCents(Math.abs(value.value))}`;
   else appendAmount(amount,value,guarded,{label,period:{year:point!.year}});
   list.append(row);
  }
  entry(`Net worth · ${point.year}`,point.netWorth);
  if(model.canCompare){
   if(point.appliedNetWorth){if(options.view.showComparison)entry('Applied plan',point.appliedNetWorth);if(point.delta)entry('Change from applied',point.delta,true);}
   else list.append(element('p','No applied comparison'));
  }
  readout.append(list);
 }
 function announce():void {const point=model.points.find(point=>point.year===selectedYear);if(point)live.textContent=`${point.year}: ${point.netWorth.status==='available'?formatCents(point.netWorth.value):point.netWorth.status==='needs-data'?'Needs data':'Unsupported'}. ${model.sourceLabel}`;}
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
  update(next,nextContext){if(disposed)return;const changed=fingerprint(model)!==fingerprint(next),completed=next.status==='preview'||next.status==='applied';model=next;context=nextContext;selectedYear=next.selectedYear;syncModelControls();if(changed||(!completed&&frame!==undefined))paintGeometry(completed);paintSelection();},
  dispose(){if(disposed)return;disposed=true;generation++;cancelAnimation();observer?.disconnect();window.removeEventListener('resize',windowResize);comparisonSwitch.dispose();listenerRemovers.forEach(remove=>remove());context.disclosures.closeWithin(readout,false);},
 };
}
