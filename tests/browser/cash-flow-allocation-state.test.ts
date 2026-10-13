import { afterEach,describe,expect,it,vi } from 'vitest';
import * as engine from '../../src/engine';
import { createWorkspace,type CashFlowAllocationDraft,type WorkspaceOperation } from '../../src/browser/state';
import { makeAllocationPlan } from '../helpers/allocations';

function setup(failStorage=false){
 let bytes='original',writes=0;
 const plan=makeAllocationPlan();delete (plan as {cashFlowAllocation?:unknown}).cashFlowAllocation;
 const controller=createWorkspace(plan,{getItem:()=>bytes,setItem:(_key,value)=>{writes++;if(failStorage)throw Error('quota');bytes=value;}});
 return {controller,bytes:()=>bytes,writes:()=>writes};
}
function edit(controller:ReturnType<typeof createWorkspace>,percent='50.00'):CashFlowAllocationDraft{
 const draft=controller.getAllocationDraft();
 const next={...draft,value:{...draft.value,entries:[{id:'entry-brokerage',priority:'1',destination:{kind:'account',accountId:'brokerage'},amount:{kind:'percent',percentBps:percent}}]}};
 controller.editAllocationDraft(next);return next;
}
afterEach(()=>vi.restoreAllMocks());
describe('independent atomic allocation drafts',()=>{
 it('caches inert defaults without activating or revising a policy and reserves their IDs',()=>{
  const {controller,writes}=setup(),before=controller.getState(),draft=controller.getAllocationDraft();
  expect(controller.getAllocationDraft()).toBe(draft);expect(controller.getState().allocationDraft).toBeUndefined();
  expect(controller.getState().savedPlan).toBe(before.savedPlan);expect(before.savedPlan.cashFlowAllocation).toBeUndefined();expect(writes()).toBe(0);
  controller.editAllocationDraft({...draft,value:{...draft.value,entries:[{id:'accounts-1',priority:'1',destination:{kind:'cash'},amount:{kind:'percent',percentBps:'10.00'}}]}});
  expect(controller.beginAdd('accounts')).not.toBe('accounts-1');
 });
 it('publishes inputs and calculation atomically with one revision, write and outcome; unrelated drafts survive',()=>{
  const {controller,writes,bytes}=setup(),unrelated=controller.beginAdd('expenses'),old=controller.getState(),draft=edit(controller),events:(WorkspaceOperation|undefined)[]=[];
  controller.subscribe(operation=>{events.push(operation);expect(controller.getState().savedPlan.cashFlowAllocation).toBeDefined();expect(controller.getState().projection.years[0]?.cashFlowAllocation).toBeDefined();});
  expect(controller.applyAllocation()).toMatchObject({accepted:true,persisted:true});
  expect(controller.getState().savedPlan.revision).toBe(old.savedPlan.revision+1);expect(writes()).toBe(1);expect(events).toHaveLength(1);expect(events[0]).toMatchObject({kind:'save',recordId:draft.recordId});
  expect(controller.getState().drafts[unrelated]).toBeDefined();expect(controller.getState().allocationDraft).toBeUndefined();expect(JSON.parse(bytes()).cashFlowAllocation.entries[0].amount.percentBps).toBe(5000);
 });
 it.each(['bad','101.00'])('retains the full transaction and stored bytes for invalid percentage %s',percent=>{
  const {controller,writes,bytes}=setup(),before=controller.getState();edit(controller,percent);const draft=controller.getState().allocationDraft;
  expect(controller.previewAllocation().status).toBe('invalid');expect(controller.applyAllocation().accepted).toBe(false);
  expect(controller.getState().savedPlan).toBe(before.savedPlan);expect(controller.getState().projection).toBe(before.projection);expect(controller.getState().allocationDraft).toBe(draft);expect(bytes()).toBe('original');expect(writes()).toBe(0);
 });
 it('retains applied state and draft if calculation unexpectedly throws',()=>{
  const {controller,writes,bytes}=setup(),before=controller.getState();edit(controller);const draft=controller.getState().allocationDraft;
  vi.spyOn(engine,'calculateProjection').mockImplementation(()=>{throw Error('synthetic failure');});
  expect(controller.previewAllocation().status).toBe('failed');expect(controller.applyAllocation()).toMatchObject({accepted:false,issues:[expect.objectContaining({code:'calculation-failed'})]});
  expect(controller.getState().savedPlan).toBe(before.savedPlan);expect(controller.getState().projection).toBe(before.projection);expect(controller.getState().allocationDraft).toBe(draft);expect(writes()).toBe(0);expect(bytes()).toBe('original');
 });
 it('keeps a valid allocation exportable when storage fails',()=>{
  const {controller,writes}=setup(true);edit(controller);
  expect(controller.applyAllocation()).toMatchObject({accepted:true,persisted:false,persistenceIssues:[expect.objectContaining({code:'storage-write-failed'})]});
  expect(writes()).toBe(1);expect(JSON.parse(controller.exportBackup()).cashFlowAllocation.entries[0].amount.percentBps).toBe(5000);expect(controller.getState().allocationDraft).toBeUndefined();
 });
 it('merges onto the latest unrelated save and rejects a policy-only stale snapshot',()=>{
  const {controller}=setup(),old=edit(controller,'10.00'),income=controller.getDraft('salaries','salary-a');
  controller.editDraft(income.recordId,{...income,value:{...income.value,annualGrossCents:'70000.00'}});expect(controller.saveRecord(income.recordId).accepted).toBe(true);
  expect(controller.applyAllocation().accepted).toBe(true);expect(controller.getState().savedPlan.salaries.find(s=>s.id==='salary-a')?.annualGrossCents).toBe(7000000);expect(controller.getState().savedPlan.revision).toBe(2);
  controller.editAllocationDraft({...old,value:{...old.value,entries:[]}});
  expect(controller.applyAllocation()).toMatchObject({accepted:false,issues:[expect.objectContaining({code:'stale-record-draft'})]});expect(controller.getState().savedPlan.revision).toBe(2);
 });
 it('revalidates links removed since editing and permits correcting a retained draft',()=>{
  const {controller}=setup();edit(controller);expect(controller.removeRecord('accounts','brokerage').accepted).toBe(true);
  expect(controller.applyAllocation().accepted).toBe(false);expect(controller.getState().issues.some(i=>i.field?.includes('accountId'))).toBe(true);
  const draft=controller.getAllocationDraft();controller.editAllocationDraft({...draft,value:{...draft.value,entries:[]}});expect(controller.applyAllocation().accepted).toBe(true);
 });
 it('discards allocation edits independently and restores both kinds of draft',()=>{
  const {controller}=setup(),id=controller.beginAdd('expenses');edit(controller);controller.discardAllocationDraft();
  expect(controller.getState().allocationDraft).toBeUndefined();expect(controller.getState().drafts[id]).toBeDefined();expect(controller.getAllocationDraft().value.entries).toEqual([]);
  edit(controller);controller.resetPlan(makeAllocationPlan({revision:4}));expect(controller.getState().allocationDraft).toBeUndefined();expect(controller.getState().drafts).toEqual({});expect(controller.previewAllocation().inputRevision).toBe(4);
 });
 it('does not let a mutable caller change a captured policy snapshot or draft',()=>{
  const {controller}=setup(),draft=edit(controller);draft.value.entries=[];
  expect(controller.getState().allocationDraft?.value.entries).toHaveLength(1);
  controller.editAllocationDraft({...draft,baseSnapshot:'forged'});expect(controller.applyAllocation().accepted).toBe(true);
 });
});
