import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {calculateProjection,loadRuleSet,type Available,type Cents,type Issue,type PlanDocument} from '../../src/engine';
import {buildGrowthChartModel,type GrowthChartViewState} from '../../src/browser/growth-chart-model';
import {mountGrowthChart} from '../../src/browser/views/growth-chart';
import {createEditorViewSession} from '../../src/browser/scenario-session';
import {withProducingPlan} from '../../src/browser/issue-presentation';
import type {ReportSnapshot} from '../../src/browser/report-snapshot';
import {mountPresentation} from '../helpers/presentation';
import {makePlan,mustValidate} from '../helpers/plans';

const amount=(value:number):Available<Cents>=>({status:'available',value});
function snapshot(values:readonly Available<Cents>[],applied?:readonly Available<Cents>[],plan=makePlan({horizonYears:values.length})):ReportSnapshot {
 const projection=calculateProjection(mustValidate(plan),loadRuleSet());
 return {plan,projection:{...projection,years:projection.years.map((row,index)=>({...row,netWorthCents:values[index]!}))},comparison:applied?{plan,projection:{...projection,years:projection.years.slice(0,applied.length).map((row,index)=>({...row,netWorthCents:applied[index]!}))}}:null,status:applied?'preview':'applied',label:applied?'Preview · Growth assumptions':'Applied results',allowDeltas:!!applied};
}
const cleanups:(()=>void)[]=[];
let resize:(width:number)=>void;
beforeEach(()=>{
 vi.stubGlobal('PointerEvent',MouseEvent);
 vi.stubGlobal('ResizeObserver',class {constructor(private callback:ResizeObserverCallback){resize=width=>this.callback([{contentRect:{width}} as ResizeObserverEntry],this as unknown as ResizeObserver);}observe(){}unobserve(){}disconnect(){}});
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
});
afterEach(()=>{cleanups.splice(0).forEach(dispose=>dispose());document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks();});
function mount(value=snapshot([amount(12500),amount(25000),amount(37500)],[amount(10000),amount(20000),amount(30000)]),selectedYear=2026) {
 const {root,context,reviews}=mountPresentation(value.plan),view:GrowthChartViewState={horizon:'all',showComparison:true},selected:number[]=[];
 const onViewChange=vi.fn(),binding=mountGrowthChart(root,buildGrowthChartModel(value,selectedYear,'all'),{view,context,onSelectYear:year=>selected.push(year),onViewChange});
 cleanups.push(binding.dispose,()=>context.disclosures.dispose());
 return {root,context,reviews,view,selected,onViewChange,binding};
}

describe('persistent growth chart',()=>{
 it('scrubs exact annual values with persistent SVG and path nodes and quiet pointer announcements',()=>{
  const {root,selected}=mount(),chart=within(root).getByRole('img',{name:'Net worth over time'}),path=root.querySelector('[data-series="producing"] path');
  vi.spyOn(chart,'getBoundingClientRect').mockReturnValue({left:0,width:600} as DOMRect);
  const initialPath=path?.getAttribute('d'),live=within(root).getByRole('status');
  fireEvent.pointerMove(chart,{clientX:550});
  expect(selected).toEqual([2028]);expect(within(root).getByLabelText('Chart year')).toHaveValue('2028');
  expect(root.querySelector('.growth-chart-readout')).toHaveTextContent('$375.00');expect(root.querySelector('.growth-chart-readout')).toHaveTextContent('+$75.00');
  expect(live).toHaveTextContent('');expect(within(root).getByRole('img',{name:'Net worth over time'})).toBe(chart);
  expect(root.querySelector('[data-series="producing"] path')).toBe(path);expect(path?.getAttribute('d')).toBe(initialPath);
  fireEvent.pointerUp(chart);expect(live).toHaveTextContent('2028');
 });
 it('supports Arrow, Home, End and native year selection while preserving focus',()=>{
  const {root,selected}=mount(),chart=within(root).getByRole('img',{name:'Net worth over time'});chart.focus();
  for(const key of ['ArrowRight','End','ArrowLeft','Home'])fireEvent.keyDown(chart,{key});
  expect(selected).toEqual([2027,2028,2027,2026]);expect(chart).toHaveFocus();
  fireEvent.change(within(root).getByLabelText('Chart year'),{target:{value:'2028'}});
  expect(selected.at(-1)).toBe(2028);expect(within(root).getByRole('status')).toHaveTextContent('2028');
 });
 it('labels the solid producing and dashed applied series and hides comparison without rescaling',()=>{
  const {root,view,onViewChange}=mount(snapshot([amount(100),amount(200)],[amount(-1000),amount(4000)]));
  const chart=within(root).getByRole('img',{name:'Net worth over time'}),path=root.querySelector('[data-series="producing"] path')!,geometry=path.getAttribute('d');
  expect(root).toHaveTextContent('Preview plan');expect(root).toHaveTextContent('Applied plan');
  expect(root.querySelector('[data-series="applied"] path')).toHaveAttribute('stroke-dasharray');
  expect(path).not.toHaveAttribute('stroke-dasharray');
  fireEvent.click(within(root).getByRole('switch',{name:'Show applied plan'}));
  expect(view.showComparison).toBe(false);expect(onViewChange).toHaveBeenCalledOnce();
  expect(root.querySelector('[data-series="applied"]')).toHaveAttribute('visibility','hidden');
  expect(path.getAttribute('d')).toBe(geometry);expect(chart).toHaveAttribute('viewBox');
 });
 it('draws zero and negative values and separates missing segments',()=>{
  const gap:Available<Cents>={status:'needs-data',issues:[]};
  const {root}=mount(snapshot([amount(-100),gap,amount(0)]));
  const path=root.querySelector('[data-series="producing"] path')!.getAttribute('d')!;
  expect(path.match(/M/g)).toHaveLength(2);expect(path).not.toContain('NaN');expect(path).not.toContain('Infinity');
  expect(root.querySelector('.growth-chart-zero')).not.toBeNull();
 });
 it('keeps a one-year forecast selectable and describes missing applied years',()=>{
  const {root,binding,context}=mount(snapshot([amount(0)],[amount(0)]));
  fireEvent.keyDown(within(root).getByRole('img',{name:'Net worth over time'}),{key:'End'});
  expect(root.querySelector('.growth-chart-readout')).toHaveTextContent('$0.00');
  binding.update(buildGrowthChartModel(snapshot([amount(0),amount(100)],[amount(0)]),2027,'all'),context);
  expect(root.querySelector('.growth-chart-readout')).toHaveTextContent('No applied comparison');
 });
 it('retains horizon controls when moving to 5Y and persists the view preference',()=>{
  const {root,view,onViewChange}=mount(snapshot(Array.from({length:20},()=>amount(0))));
  const button=within(root).getByRole('button',{name:'5Y'});button.focus();fireEvent.click(button);
  expect(view.horizon).toBe(5);expect(onViewChange).toHaveBeenCalledOnce();expect(button).toHaveFocus();
  for(const name of ['5Y','10Y','15Y','All'])expect(within(root).getByRole('button',{name})).toBeVisible();
 });
 it('resizes geometry to a narrow container without changing monetary values',()=>{
  const {root}=mount(),chart=within(root).getByRole('img',{name:'Net worth over time'});resize(320);
  expect(chart.getAttribute('viewBox')).toMatch(/^0 0 320 /);expect(root.querySelector('.growth-chart-readout')).toHaveTextContent('$125.00');
  const viewBox=chart.getAttribute('viewBox')!.split(' ').map(Number);expect(viewBox[3]).toBeGreaterThanOrEqual(240);
 });
 it('updates source status without presenting stale numeric comparison',()=>{
  const value=snapshot([amount(12500)],[amount(10000)]),{root,binding,context}=mount(value);
  binding.update(buildGrowthChartModel({...value,status:'paused',label:'Preview paused · previous preview'},2026,'all'),context);
  expect(root).toHaveTextContent('Preview paused · previous preview');expect(root.querySelector('.growth-chart-readout')).not.toHaveTextContent('+$25.00');
  expect(within(root).getByRole('switch',{name:'Show applied plan'})).toBeDisabled();
 });
 it('routes unavailable amounts through the latest producing plan and makes detached review actions inert',()=>{
  const issue:Issue={code:'required-history',recordId:'account',field:'openingBalanceCents',severity:'warning',explanation:'Missing balance.',resolution:'Review this account.'};
  const plan=(name:string)=>makePlan({accounts:[{id:'account',name,ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:true,value:0}}]});
  const value=snapshot([{status:'needs-data',issues:[issue]}],undefined,plan('Old account')),{root,binding,context,reviews}=mount(value);
  fireEvent.click(within(root.querySelector<HTMLElement>('.growth-chart-readout')!).getByRole('button'));
  const oldAction=within(document.body).getByRole('button',{name:'Review Old account'});
  const next=plan('New account');binding.update(buildGrowthChartModel({...value,plan:next},2026,'all'),withProducingPlan(context,next));
  fireEvent.click(oldAction);expect(reviews).toEqual([]);
  fireEvent.click(within(root.querySelector<HTMLElement>('.growth-chart-readout')!).getByRole('button'));
  fireEvent.click(within(document.body).getByRole('button',{name:'Review New account'}));
  expect(reviews).toMatchObject([{recordId:'account',label:'Review New account'}]);
 });
 it('updates completed amounts immediately and skips animation under reduced motion',()=>{
  const {root,binding,context}=mount(),path=root.querySelector('[data-series="producing"] path');
  binding.update(buildGrowthChartModel(snapshot([amount(50000),amount(60000),amount(70000)]),2026,'all'),context);
  expect(root.querySelector('.growth-chart-readout')).toHaveTextContent('$500.00');
  expect(root.querySelector('[data-series="producing"] path')).toBe(path);expect(root.querySelector('.growth-chart')).toHaveAttribute('data-animation','none');
 });
 it('animates a completed curve for 180ms and cancels frames on disposal',()=>{
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  const frames=new Map<number,FrameRequestCallback>();let next=0;
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const tick=(time:number)=>{const current=[...frames.values()];frames.clear();current.forEach(callback=>callback(time));};
  const {root,binding,context}=mount();
  binding.update(buildGrowthChartModel(snapshot([amount(50000),amount(0),amount(-50000)],[amount(10000),amount(20000),amount(30000)]),2026,'all'),context);
  expect(root.querySelector('.growth-chart-readout')).toHaveTextContent('$500.00');expect(root.querySelector('.growth-chart')).toHaveAttribute('data-animation','morph');
  tick(0);tick(180);expect(root.querySelector('.growth-chart')).toHaveAttribute('data-animation','none');
  binding.update(buildGrowthChartModel(snapshot([amount(50000),{status:'needs-data',issues:[]},amount(-50000)]),2026,'all'),context);
  expect(root.querySelector('.growth-chart')).toHaveAttribute('data-animation','crossfade');
  binding.dispose();expect(frames.size).toBe(0);expect(root.querySelector('.growth-chart-ghost')).toBeNull();
 });
 it('finishes any running transition when the same producing data becomes pending',()=>{
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  const frames=new Map<number,FrameRequestCallback>();let next=0;
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const {root,binding,context}=mount(snapshot([amount(100),amount(200),amount(300)]));
  const completed=snapshot([amount(500),amount(0),amount(-500)]);
  binding.update(buildGrowthChartModel(completed,2026,'all'),context);
  expect(root.querySelector('.growth-chart')).toHaveAttribute('data-animation','morph');
  binding.update(buildGrowthChartModel({...completed,status:'updating',label:'Updating · applied results'},2026,'all'),context);
  expect(frames.size).toBe(0);expect(root.querySelector('.growth-chart')).toHaveAttribute('data-animation','none');
  expect(root).toHaveTextContent('Updating · applied results');
 });
 it('stops detached controls, resize callbacks, and chart selections after disposal',()=>{
  const {root,binding,selected,onViewChange}=mount(),chart=within(root).getByRole('img',{name:'Net worth over time'}),toggle=within(root).getByRole('switch',{name:'Show applied plan'});
  binding.dispose();fireEvent.keyDown(chart,{key:'End'});fireEvent.click(toggle);resize(320);
  expect(selected).toEqual([]);expect(onViewChange).not.toHaveBeenCalled();
 });
 it('clones view-only chart preferences independently of plan inputs',()=>{
  const plan=makePlan(),view=createEditorViewSession(plan);expect(view.growthChart).toEqual({horizon:'all',showComparison:true});
  view.growthChart.horizon=5;view.growthChart.showComparison=false;
  const fork=createEditorViewSession(plan,view.selections,view.growthChart);expect(fork.growthChart).toEqual({horizon:5,showComparison:false});
  fork.growthChart.showComparison=true;expect(view.growthChart.showComparison).toBe(false);expect(plan).not.toHaveProperty('growthChart');
 });
});
