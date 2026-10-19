import {afterEach,describe,expect,it,vi} from 'vitest';
import * as engine from '../../src/engine';
import {applyCalculatedEdit,completePreparedEdit,prepareEdit} from '../../src/browser/state';
import {createGrowthDraft,decodeGrowthDraft,growthAssumptionsSnapshot} from '../../src/browser/growth-assumptions';
import {createEditPreviewCoordinator} from '../../src/browser/edit-preview';
import {selectReportSnapshot} from '../../src/browser/report-snapshot';
import {calculateEdit,createEditHarness,setDraftField} from '../helpers/editing';
import {makeGrowthPlan,makeScheduledGrowthPlan} from '../helpers/growth';
import {installPreviewWorker} from '../helpers/preview-worker';
import type {EditPreviewCoordinator} from '../../src/browser/edit-types';
const target={kind:'growth-assumptions'} as const;
const owner={scenarioId:'master',sessionGeneration:1,activationGeneration:1,workspaceGeneration:1};
function stage(controller:ReturnType<typeof createEditHarness>['controller'],defaults:Record<string,string>={stocksBps:'7.70'},accounts:readonly string[]=['stock'],properties:readonly string[]=[]){
 controller.editGrowthDraft({...controller.getGrowthDraft(),value:{defaults,inheritAccountIds:accounts,inheritPropertyIds:properties}});
}
afterEach(()=>vi.restoreAllMocks());
describe('scenario-owned reviewed growth transaction',()=>{
 it('applies defaults and membership as one reviewed transaction',()=>{
  const {controller,store}=createEditHarness(makeGrowthPlan());stage(controller);
  const receipt=calculateEdit(controller,target),calculate=vi.spyOn(engine,'calculateProjection');
  expect(controller.getState().savedPlan.growthAssumptions).toBeUndefined();expect(store.writes()).toBe(0);
  expect(applyCalculatedEdit(controller,receipt).accepted).toBe(true);expect(calculate).not.toHaveBeenCalled();
  expect(controller.getState().savedPlan).toMatchObject({revision:1,growthAssumptions:{stocksBps:770}});
  expect(controller.getState().savedPlan.accounts[0]).toMatchObject({annualGrowthBps:500,growthSource:'stocks-default'});
  expect(controller.getState().growthDraft).toBeUndefined();expect(store.writes()).toBe(1);
  expect(applyCalculatedEdit(controller,receipt).accepted).toBe(false);
 });
 it('opening a draft is passive and only reflects applied defaults and membership',()=>{
  const {controller,store}=createEditHarness(makeGrowthPlan());
  expect(controller.getGrowthDraft().value).toEqual({defaults:{},inheritAccountIds:[],inheritPropertyIds:[]});
  expect(controller.getState().growthDraft).toBeUndefined();expect(prepareEdit(controller,target).status).toBe('unchanged');expect(store.writes()).toBe(0);
 });
 it('restores retained custom rates when unchecked and omits empty defaults',()=>{
  const {controller}=createEditHarness(makeGrowthPlan());stage(controller,{stocksBps:'7.70',propertyBps:'4.00'},['stock'],['home']);
  expect(applyCalculatedEdit(controller,calculateEdit(controller,target)).accepted).toBe(true);
  stage(controller,{stocksBps:'',propertyBps:''},[],[]);
  expect(applyCalculatedEdit(controller,calculateEdit(controller,target)).accepted).toBe(true);
  const saved=controller.getState().savedPlan;
  expect(saved).not.toHaveProperty('growthAssumptions');expect(saved.accounts[0]).not.toHaveProperty('growthSource');expect(saved.accounts[0]!.annualGrowthBps).toBe(500);
  expect(saved.properties[0]).not.toHaveProperty('appreciationSource');expect(saved.properties[0]!.appreciationBps).toBe(300);
 });
 it('configures only property and preserves an explicit zero',()=>{
  const {controller}=createEditHarness(makeGrowthPlan());stage(controller,{propertyBps:'0.00'},[],['home']);
  expect(applyCalculatedEdit(controller,calculateEdit(controller,target)).accepted).toBe(true);
  expect(controller.getState().savedPlan.growthAssumptions).toEqual({propertyBps:0});
 });
 it.each(['duplicate account','missing account','rsu','duplicate property','missing property','missing default','partial rate','too low','too high'])('rejects %s atomically',kind=>{
  const {controller,store}=createEditHarness(makeScheduledGrowthPlan()),before=controller.getState();
  const accounts=kind==='duplicate account'?['stock','stock']:kind==='missing account'?['gone']:kind==='rsu'?['scheduled']:['stock'];
  const properties=kind==='duplicate property'?['home','home']:kind==='missing property'?['gone']:[];
  const defaults=kind==='missing default'?{}:kind==='partial rate'?{stocksBps:'-'}:kind==='too low'?{stocksBps:'-100.00'}:kind==='too high'?{stocksBps:'1000.01'}:{stocksBps:'7.70',propertyBps:'4.00'};
  stage(controller,defaults,accounts,properties);
  expect(prepareEdit(controller,target).status).toBe('invalid');expect(controller.getState().savedPlan).toBe(before.savedPlan);expect(store.writes()).toBe(0);expect(controller.getState().growthDraft).toBeDefined();
 });
 it('excludes other raw record/allocation drafts and clears only growth',()=>{
  const {controller}=createEditHarness(makeGrowthPlan());setDraftField(controller,{kind:'record',section:'accounts',recordId:'custom'},['annualGrowthBps'],'unfinished');
  setDraftField(controller,{kind:'allocation'},['entries'],[{id:'unfinished',priority:'-'}]);stage(controller);
  expect(applyCalculatedEdit(controller,calculateEdit(controller,target)).accepted).toBe(true);
  expect(controller.getState().savedPlan.accounts[1]!.annualGrowthBps).toBe(650);
  expect(controller.getState().drafts.custom!.value.annualGrowthBps).toBe('unfinished');expect(controller.getState().allocationDraft).toBeDefined();
 });
 it('treats formatting and reversed changes as no-ops without writes',()=>{
  const {controller,store}=createEditHarness(makeGrowthPlan({growthAssumptions:{stocksBps:770}}));
  stage(controller,{stocksBps:'7.7'},[]);expect(prepareEdit(controller,target).status).toBe('unchanged');
  stage(controller,{stocksBps:'8.00'},['stock']);stage(controller,{stocksBps:'7.70'},[]);
  expect(prepareEdit(controller,target).status).toBe('unchanged');expect(store.writes()).toBe(0);
 });
 it('rejects changed or ineligible membership without a partial apply',()=>{
  const {controller}=createEditHarness(makeGrowthPlan());stage(controller);
  const original=controller.getGrowthDraft().baseSnapshot,receipt=calculateEdit(controller,target);
  setDraftField(controller,{kind:'record',section:'accounts',recordId:'stock'},['annualGrowthBps'],'6.00');expect(controller.saveRecord('stock').accepted).toBe(true);
  stage(controller,{stocksBps:'8.00'});expect(controller.getGrowthDraft().baseSnapshot).toBe(original);
  expect(prepareEdit(controller,target).status).toBe('stale');const before=controller.getState().savedPlan;
  expect(applyCalculatedEdit(controller,receipt).accepted).toBe(false);expect(controller.getState().savedPlan).toBe(before);expect(before.growthAssumptions).toBeUndefined();
 });
 it('rejects removed membership and pins property overrides in its base snapshot',()=>{
  const {controller}=createEditHarness(makeGrowthPlan());stage(controller);expect(controller.removeRecord('accounts','stock').accepted).toBe(true);
  expect(prepareEdit(controller,target).status).toBe('stale');
  const plan=makeGrowthPlan(),modified={...plan,properties:plan.properties.map(p=>({...p,appreciationOverrides:[{year:2026,rateBps:900}]}))};
  expect(growthAssumptionsSnapshot(plan)).not.toBe(growthAssumptionsSnapshot(modified));
 });
 it('rebases unrelated applied inputs and lets unchanged record drafts rebase against a shared rate',()=>{
  const {controller}=createEditHarness(makeGrowthPlan({growthAssumptions:{stocksBps:700}}));stage(controller);
  setDraftField(controller,{kind:'record',section:'household',recordId:'household'},['openingCashCents'],'10.00');expect(controller.saveRecord('household').accepted).toBe(true);
  const receipt=calculateEdit(controller,target);expect(receipt.prepared.plan.openingCashCents).toBe(1000);expect(receipt.prepared.basePlan.revision).toBe(1);
  expect(applyCalculatedEdit(controller,receipt).accepted).toBe(true);
  setDraftField(controller,{kind:'record',section:'accounts',recordId:'stock'},['name'],'Retained draft');
  stage(controller,{stocksBps:'8.00'});expect(applyCalculatedEdit(controller,calculateEdit(controller,target)).accepted).toBe(true);
  expect(prepareEdit(controller,{kind:'record',section:'accounts',recordId:'stock'}).status).toBe('ready');
 });
 it('stales an owning-record draft when bulk membership changes its source',()=>{
  const {controller}=createEditHarness(makeGrowthPlan());setDraftField(controller,{kind:'record',section:'accounts',recordId:'stock'},['name'],'Retained draft');
  stage(controller);expect(applyCalculatedEdit(controller,calculateEdit(controller,target)).accepted).toBe(true);
  expect(prepareEdit(controller,{kind:'record',section:'accounts',recordId:'stock'}).status).toBe('stale');
 });
 it('invalidates receipts on discard/reset and exports applied inputs only',()=>{
  const plan=makeGrowthPlan(),{controller}=createEditHarness(plan);stage(controller);const receipt=calculateEdit(controller,target);
  expect(controller.exportBackup()).not.toContain('stocksBps');controller.discardGrowthDraft();expect(applyCalculatedEdit(controller,receipt).accepted).toBe(false);
  stage(controller);const pending=prepareEdit(controller,target);if(pending.status!=='ready')throw Error('Expected ready');controller.resetPlan(plan);
  expect(completePreparedEdit(controller,pending,engine.calculateProjection(pending.plan,pending.ruleSet))).toBeNull();expect(controller.getState().growthDraft).toBeUndefined();
 });
 it('keeps successfully applied inputs in memory when local persistence fails',()=>{
  const {controller,store}=createEditHarness(makeGrowthPlan());store.port.setItem=()=>{throw Error('quota');};stage(controller);
  expect(applyCalculatedEdit(controller,calculateEdit(controller,target))).toMatchObject({accepted:true,persisted:false,persistenceIssues:[{code:'storage-write-failed'}]});
  expect(controller.getState().savedPlan.growthAssumptions).toEqual({stocksBps:770});expect(controller.getState().growthDraft).toBeUndefined();expect(JSON.parse(controller.exportBackup()).growthAssumptions).toEqual({stocksBps:770});
 });
 it('decodes with no invented record identity and leaves applied inputs untouched',()=>{
  const plan=makeGrowthPlan(),draft=createGrowthDraft(plan),decoded=decodeGrowthDraft({...draft,value:{...draft.value,defaults:{stocksBps:'-'}}},plan);
  expect(decoded.issues.length).toBeGreaterThan(0);expect(decoded.issues.every(issue=>issue.recordId===undefined)).toBe(true);expect(plan.growthAssumptions).toBeUndefined();
 });
});
describe('growth preview ownership and scheduling',()=>{
 let clock:ReturnType<typeof installPreviewWorker>,coordinator:EditPreviewCoordinator;
 afterEach(()=>{coordinator?.dispose();clock?.restore();});
 function setup(){clock=installPreviewWorker();const harness=createEditHarness(makeGrowthPlan());let active=true;coordinator=createEditPreviewCoordinator(harness.controller,{owner,isCurrent:()=>active});return {...harness,inactive:()=>{active=false;}};}
 it('coalesces at 100ms, bounds a drag to 300ms, flushes commits and reuses the projection',()=>{
  const {controller,store}=setup();coordinator.select(target);stage(controller);clock.flush(99);expect(clock.workers).toHaveLength(0);clock.flush(1);expect(clock.workers).toHaveLength(1);
  for(let i=0;i<5;i++){stage(controller,{stocksBps:`8.${i}0`});clock.flush(60);}expect(clock.workers.length).toBeGreaterThanOrEqual(2);
  stage(controller,{stocksBps:'9.00'});coordinator.request(true);clock.flush();clock.workers.at(-1)!.reply();
  expect(selectReportSnapshot(controller.getState(),coordinator.getState())).toMatchObject({status:'preview',label:'Preview · Growth assumptions',allowDeltas:true});
  const projection=coordinator.getState().current!.projection;coordinator.request(true);expect(coordinator.getState().current!.projection).toBe(projection);
  expect(coordinator.apply().accepted).toBe(true);expect(controller.getState().projection).toBe(projection);expect(store.writes()).toBe(1);
 });
 it('rejects restored growth completions with reused identities',()=>{
  const {controller}=setup();coordinator.select(target);stage(controller);clock.flush(100);const old=clock.workers[0]!;
  controller.resetPlan(makeGrowthPlan());stage(controller);coordinator.select(target);clock.flush(100);old.reply();expect(coordinator.getState().current).toBeNull();expect(coordinator.apply().accepted).toBe(false);
  clock.workers.at(-1)!.reply();expect(coordinator.getState().status).toBe('valid');
 });
 it('rejects inactive ownership, detached completions and discards only growth',()=>{
  const {controller,inactive}=setup();coordinator.select(target);stage(controller);clock.flush(100);const old=clock.workers[0]!;
  setDraftField(controller,{kind:'record',section:'accounts',recordId:'custom'},['annualGrowthBps'],'-');coordinator.discard();old.reply();expect(coordinator.getState().current).toBeNull();expect(controller.getState().drafts.custom).toBeDefined();
  stage(controller);clock.flush(100);inactive();clock.workers.at(-1)!.reply();expect(coordinator.apply().accepted).toBe(false);expect(controller.getState().savedPlan.revision).toBe(0);
 });
});
