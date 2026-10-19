import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createWorkspace,prepareAllocationPreview,type CashFlowAllocationPreview } from '../../src/browser/state';
import { makeAllocationPlan } from '../helpers/allocations';
import { calculateProjection,loadRuleSet,type RuleSet } from '../../src/engine';

import { createAllocationPreviewScheduler as createScheduler } from '../../src/browser/allocation-preview';
let frames:Map<number,FrameRequestCallback>,sequence:number;
beforeEach(()=>{frames=new Map();sequence=0;vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++sequence,cb);return sequence;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));vi.stubGlobal('Worker',undefined);});
afterEach(()=>vi.unstubAllGlobals());
function flush(){const current=[...frames.values()];frames.clear();current.forEach(cb=>cb(0));}
function edit(controller:ReturnType<typeof createWorkspace>,percent:string){const draft=controller.getAllocationDraft();controller.editAllocationDraft({...draft,value:{...draft.value,entries:[{id:'percent-cash',priority:'1',destination:{kind:'cash'},amount:{kind:'percent',percentBps:percent}}]}});}
function setup(ruleSet?:RuleSet){const controller=createWorkspace(makeAllocationPlan({horizonYears:2}),{getItem:()=>null,setItem:()=>{}},ruleSet),published:CashFlowAllocationPreview[]=[];const scheduler=createScheduler(controller,p=>published.push(p));return {controller,published,scheduler};}
describe('latest guarded allocation previews',()=>{
 it('provides a cancellable preview queue',()=>{expect(createScheduler).toBeTypeOf('function');});
 it('coalesces 10 then 50 percent against latest saved inputs without changing applied projection',()=>{
  const {controller,published,scheduler}=setup();edit(controller,'10.00');scheduler.request();edit(controller,'50.00');scheduler.request();
  const income=controller.getDraft('salaries','salary-a');controller.editDraft(income.recordId,{...income,value:{...income.value,annualGrossCents:'90000.00'}});controller.saveRecord(income.recordId);
  const applied=controller.getState().projection;flush();expect(published).toHaveLength(1);expect(published[0]).toEqual(controller.previewAllocation());expect(published[0]?.inputRevision).toBe(1);expect(controller.getState().projection).toBe(applied);scheduler.dispose();
 });
 it('lets a changed selected year read the latest complete forecast',()=>{
  const controller=createWorkspace(makeAllocationPlan({horizonYears:2}),{getItem:()=>null,setItem:()=>{}});let selectedYear=2026,displayedYear:number|undefined;
  const scheduler=createScheduler(controller,preview=>{if(preview.status==='calculated')displayedYear=preview.projection.years.find(year=>year.year===selectedYear)?.year;});
  edit(controller,'10.00');scheduler.request();edit(controller,'50.00');scheduler.request();selectedYear=2027;flush();expect(displayedYear).toBe(2027);scheduler.dispose();
 });
 it.each(['apply','discard','restore','dispose','invalidate'])('cancels pending work on %s',action=>{
  const {controller,published,scheduler}=setup();edit(controller,'10.00');scheduler.request();
  if(action==='apply')controller.applyAllocation();if(action==='discard')controller.discardAllocationDraft();if(action==='restore')controller.resetPlan(makeAllocationPlan());if(action==='dispose')scheduler.dispose();if(action==='invalidate')scheduler.invalidate();flush();expect(published).toEqual([]);scheduler.dispose();
 });
});

class ControlledWorker {
 static instances:ControlledWorker[]=[];
 onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:Event)=>void)|null=null;onmessageerror:((event:Event)=>void)|null=null;
 request:any;terminated=false;
 constructor(readonly url:URL,readonly options:WorkerOptions){ControlledWorker.instances.push(this);}
 postMessage(request:unknown){this.request=structuredClone(request);}
 terminate(){this.terminated=true;}
 reply(){const {generation,plan,ruleSet,inputRevision}=this.request;this.onmessage?.({data:{generation,preview:{status:'calculated',projection:calculateProjection(plan,ruleSet),inputRevision}}} as MessageEvent);}
}
describe('module worker preview transport',()=>{
 beforeEach(()=>{ControlledWorker.instances=[];vi.stubGlobal('Worker',ControlledWorker);});
 it('uses a module worker with exact rules and latest full candidate',()=>{
  const original=loadRuleSet(),ruleSet={...original,version:'synthetic-workspace-rules',payroll:{...original.payroll,values:{...original.payroll.values,sdiRateBps:{...original.payroll.values.sdiRateBps!,value:0}}}}, {controller,published,scheduler}=setup(ruleSet);edit(controller,'50.00');scheduler.request();flush();
  expect(published).toEqual([]);const worker=ControlledWorker.instances[0]!;expect(worker.options.type).toBe('module');expect(worker.request.ruleSet).toEqual(ruleSet);expect(worker.request.plan.cashFlowAllocation.entries[0].amount.percentBps).toBe(5000);
  worker.reply();expect(published).toEqual([controller.previewAllocation()]);scheduler.dispose();
 });
 it('terminates obsolete computation and rejects late replies and saved-plan identities',()=>{
  const {controller,published,scheduler}=setup();edit(controller,'10.00');scheduler.request();flush();const old=ControlledWorker.instances[0]!;
  edit(controller,'50.00');scheduler.request();expect(old.terminated).toBe(true);flush();const second=ControlledWorker.instances[1]!;
  const income=controller.getDraft('salaries','salary-a');controller.editDraft(income.recordId,{...income,value:{...income.value,annualGrossCents:'90000.00'}});controller.saveRecord(income.recordId);expect(second.terminated).toBe(true);flush();
  old.reply();second.reply();expect(published).toEqual([]);ControlledWorker.instances[2]!.reply();expect(published).toEqual([controller.previewAllocation()]);scheduler.dispose();
 });
 it('rejects a matching-generation response for the wrong input revision',()=>{
  const {controller,published,scheduler}=setup();edit(controller,'50.00');scheduler.request();flush();const worker=ControlledWorker.instances[0]!;
  worker.request.inputRevision=999;worker.reply();expect(published).toEqual([]);
  worker.request.inputRevision=0;worker.reply();expect(published).toEqual([controller.previewAllocation()]);scheduler.dispose();
 });
 it.each(['apply','discard','restore','dispose'])('terminates running worker and rejects late reply on %s',action=>{
  const {controller,published,scheduler}=setup();edit(controller,'50.00');scheduler.request();flush();const worker=ControlledWorker.instances[0]!;
  if(action==='apply')controller.applyAllocation();if(action==='discard')controller.discardAllocationDraft();if(action==='restore')controller.resetPlan(makeAllocationPlan());if(action==='dispose')scheduler.dispose();
  expect(worker.terminated).toBe(true);worker.reply();flush();expect(published).toEqual([]);scheduler.dispose();
 });
 it('publishes explicit failure on worker errors instead of blocking on synchronous fallback',()=>{
  const {controller,published,scheduler}=setup();edit(controller,'50.00');scheduler.request();flush();const worker=ControlledWorker.instances[0]!;worker.onerror?.(new Event('error'));
  expect(published[0]).toMatchObject({status:'failed',inputRevision:0,issues:[expect.objectContaining({code:'calculation-failed'})]});expect(worker.terminated).toBe(true);scheduler.dispose();
 });
 it('settles a request once so replies after a worker error cannot replace the failure',()=>{
  const {controller,published,scheduler}=setup();edit(controller,'50.00');scheduler.request();flush();const worker=ControlledWorker.instances[0]!;
  worker.onerror?.(new Event('error'));worker.reply();expect(published).toHaveLength(1);expect(published[0]?.status).toBe('failed');scheduler.dispose();
 });
 it('validates a candidate before sending it to a worker',()=>{
  const {controller,published,scheduler}=setup();edit(controller,'101.00');scheduler.request();flush();expect(ControlledWorker.instances).toEqual([]);expect(published[0]?.status).toBe('invalid');scheduler.dispose();
 });
 it('rejects worker transport failure and can calculate a later request',()=>{
  const {controller,published,scheduler}=setup();edit(controller,'50.00');scheduler.request();flush();ControlledWorker.instances[0]!.onmessageerror?.(new Event('messageerror'));
  expect(published[0]?.status).toBe('failed');scheduler.request();flush();ControlledWorker.instances[1]!.reply();expect(published[1]?.status).toBe('calculated');scheduler.dispose();
 });
 it('shares the prepared latest candidate with synchronous preview',()=>{
  const {controller,scheduler}=setup();edit(controller,'50.00');const prepared=prepareAllocationPreview(controller);expect(prepared.status).toBe('ready');
  if(prepared.status!=='ready')throw Error('Expected valid candidate');expect(controller.previewAllocation()).toEqual({status:'calculated',projection:calculateProjection(prepared.plan,prepared.ruleSet),inputRevision:0});scheduler.dispose();
 });
});

it('echoes worker ownership and rejects old session or activation replies even with matching financial identities',()=>{
 ControlledWorker.instances=[];vi.stubGlobal('Worker',ControlledWorker);const {controller}=setup();const owner={scenarioId:'master',sessionGeneration:4,activationGeneration:9};let active=true;const published:CashFlowAllocationPreview[]=[];
 const scheduler=createScheduler(controller,p=>published.push(p),{owner,isCurrent:()=>active});edit(controller,'20.00');scheduler.request();flush();const worker=ControlledWorker.instances[0]!;expect(worker.request.owner).toEqual(owner);
 const reply=calculateAllocationPreview(worker.request);expect(reply.owner).toEqual(owner);active=false;worker.onmessage?.({data:reply} as MessageEvent);expect(published).toEqual([]);scheduler.dispose();expect(worker.terminated).toBe(true);
});
import {calculateAllocationPreview} from '../../src/browser/allocation-preview-worker';

it('uses the applied allocation result without a worker for unchanged inputs',()=>{
 ControlledWorker.instances=[];vi.stubGlobal('Worker',ControlledWorker);const {controller,published,scheduler}=setup();scheduler.request();flush();expect(ControlledWorker.instances).toHaveLength(0);expect(published).toEqual([{status:'calculated',projection:controller.getState().projection,inputRevision:0}]);expect(controller.getState().savedPlan.revision).toBe(0);scheduler.dispose();
});
