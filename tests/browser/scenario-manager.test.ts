import {afterEach,describe,it,expect,vi} from 'vitest';
import * as engine from '../../src/engine';
import {createScenarioManager} from '../../src/browser/scenario-manager';
import {exportWorkspace,WORKSPACE_STORAGE_KEY,type WorkspacePersistence} from '../../src/browser/workspace-storage';
import {makeScenarioWorkspace,memoryWorkspaceStorage} from '../helpers/scenarios';
import {makePlan} from '../helpers/plans';
import {makeAllocationPlan} from '../helpers/allocations';
import fixture from '../../fixtures/math/projection.json';
const referencePlan=(id:string)=>fixture.find(c=>c.id===id)!.input as unknown as engine.PlanDocument;
function setup(doc=makeScenarioWorkspace(),initial?:Partial<WorkspacePersistence>,ids=()=> 'fork'){
 const raw=exportWorkspace(doc),store=memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,raw]]));
 const manager=createScenarioManager(doc,store.port,engine.loadRuleSet(),{persisted:true,persistenceIssues:[],suspension:'none',observedRaw:raw,...initial},ids);return {manager,store};
}
function edit(editor:ReturnType<typeof createScenarioManager>['getActiveSession'] extends ()=>infer T?T extends {controller:infer C}?C:never:never,value:string){const draft=editor.getDraft('household','household');editor.editDraft('household',{...draft,value:{...draft.value,openingCashCents:value}});}
afterEach(()=>vi.restoreAllMocks());
describe('independent scenario sessions',()=>{
 it.each([makeAllocationPlan(),makePlan({children:[{id:'child',name:'Child',birthMonth:'2020-01',includeAge18:false}]})])('forks exact applied inputs with a fresh clean session',plan=>{
  const {manager,store}=setup(makeScenarioWorkspace(plan)),source=manager.getActiveSession();source.view.selections.inputSection='Investments';edit(source.controller,'1.234');source.controller.beginAdd('salaries');
  expect(manager.forkScenario(manager.captureTarget('master')!,'Lower growth').accepted).toBe(true);const fork=manager.getActiveSession();
  expect(fork.scenarioId).toBe('fork');expect(fork.controller.getState().savedPlan).toEqual(source.controller.getState().savedPlan);expect(fork.controller.getState().savedPlan).not.toBe(source.controller.getState().savedPlan);expect(fork.controller.getState().projection).toEqual(source.controller.getState().projection);expect(fork.controller.getState().drafts).toEqual({});expect(fork.view.selections.inputSection).toBe('Investments');expect(store.writes()).toBe(1);
  edit(fork.controller,'10.00');expect(fork.controller.saveRecord('household').accepted).toBe(true);manager.switchScenario('master');expect(manager.getActiveSession()).toBe(source);expect(source.controller.getState().savedPlan.revision).toBe(0);expect(source.controller.getState().drafts.household?.value.openingCashCents).toBe('1.234');expect(manager.getState().document.scenarios.find(s=>s.id==='fork')!.plan.openingCashCents).toBe(1000);
 });
 it('forks the complete linked reference plan without changing IDs or calculation',()=>{const {manager}=setup(makeScenarioWorkspace(referencePlan('two-salaries-home-adu')));const source=manager.getActiveSession();expect(manager.forkScenario(manager.captureTarget('master')!,'Home experiment').accepted).toBe(true);expect(manager.getActiveSession().controller.getState().savedPlan).toEqual(source.controller.getState().savedPlan);expect(manager.getActiveSession().controller.getState().projection).toEqual(source.controller.getState().projection);});
 it('keeps stale bases local and restores nested and new-record drafts',()=>{
  const {manager}=setup(makeScenarioWorkspace(makeAllocationPlan()));const master=manager.getActiveSession();const d=master.controller.getDraft('accounts','brokerage');master.controller.editDraft('brokerage',{...d,value:{...d.value,annualGrowthBps:'1.234'}});const id=master.controller.beginAdd('accounts');
  manager.forkScenario(manager.captureTarget('master')!,'Fork');const fork=manager.getActiveSession();const f=fork.controller.getDraft('accounts','brokerage');fork.controller.editDraft('brokerage',{...f,value:{...f.value,annualGrowthBps:'5.00'}});expect(fork.controller.saveRecord('brokerage').accepted).toBe(true);manager.switchScenario('master');expect(master.controller.getState().drafts[id]).toBeDefined();master.controller.editDraft('brokerage',{...master.controller.getDraft('accounts','brokerage'),value:{...d.value,annualGrowthBps:'2.00'}});expect(master.controller.saveRecord('brokerage').accepted).toBe(true);
 });
 it('retains provenance after deleting a source and protects the baseline',()=>{
  let n=0;const {manager}=setup(undefined,undefined,()=>`fork-${++n}`);manager.forkScenario(manager.captureTarget('master')!,'First');manager.forkScenario(manager.captureTarget('fork-1')!,'Second');
  expect(manager.deleteScenario(manager.captureTarget('master')!).accepted).toBe(false);expect(manager.deleteScenario(manager.captureTarget('fork-1')!).accepted).toBe(true);expect(manager.getState().document.scenarios[1]!.forkedFrom).toEqual({scenarioId:'fork-1',scenarioName:'First',planRevision:0});
  expect(manager.deleteScenario(manager.captureTarget('fork-2')!).accepted).toBe(true);expect(manager.getActiveSession().scenarioId).toBe('master');
 });
 it('captures and deletes unvisited inactive scenarios without calculation',()=>{
  const doc=makeScenarioWorkspace();const {manager}=setup({...doc,scenarios:[...doc.scenarios,{id:'cold',name:'Cold',plan:makePlan()}]});const spy=vi.spyOn(engine,'calculateProjection');const target=manager.captureTarget('cold')!;expect(manager.getSession('cold')).toBeUndefined();expect(manager.deleteScenario(target).accepted).toBe(true);expect(spy).not.toHaveBeenCalled();
 });
 it('does not write or increment for drafts, no-op selection and unchanged rename',()=>{
  const {manager,store}=setup();const doc=manager.getState().document;edit(manager.getActiveSession().controller,'1.00');expect(manager.switchScenario('master').accepted).toBe(true);expect(manager.renameScenario('master',' Master ').accepted).toBe(true);expect(manager.getState().document).toBe(doc);expect(store.writes()).toBe(0);expect(manager.renameScenario('master','Baseline').accepted).toBe(true);expect(store.writes()).toBe(1);expect(manager.getActiveSession().controller.getState().savedPlan.revision).toBe(0);
 });
 it.each(['workspace','input'])('rejects %s revision overflow before mutating drafts or storage',kind=>{
  const {manager,store}=setup(makeScenarioWorkspace(makePlan({revision:kind==='input'?Number.MAX_SAFE_INTEGER:0}),{workspaceRevision:kind==='workspace'?Number.MAX_SAFE_INTEGER:0})),editor=manager.getActiveSession().controller,before=editor.getState();edit(editor,'1.00');expect(editor.saveRecord('household').accepted).toBe(false);expect(editor.getState().savedPlan).toBe(before.savedPlan);expect(editor.getState().drafts.household?.value.openingCashCents).toBe('1.00');expect(store.writes()).toBe(0);
 });
 it('rejects ID collisions, invalid names and preparation failures atomically',()=>{
  const {manager,store}=setup(undefined,undefined,()=> 'master'),before=manager.getState();expect(manager.forkScenario(manager.captureTarget('master')!,'Fork').accepted).toBe(false);expect(manager.forkScenario(manager.captureTarget('master')!,'MASTER').accepted).toBe(false);expect(manager.getState().document).toBe(before.document);expect(store.writes()).toBe(0);
  const doc=makeScenarioWorkspace();const other=setup({...doc,scenarios:[...doc.scenarios,{id:'cold',name:'Cold',plan:makePlan()}]});const source=other.manager.getActiveSession();vi.spyOn(engine,'calculateProjection').mockImplementation(()=>{throw Error('unexpected');});expect(other.manager.switchScenario('cold').accepted).toBe(false);expect(other.manager.getActiveSession()).toBe(source);expect(other.store.writes()).toBe(0);
 });
 it('publishes coherent applied changes once and revokes deleted controllers',()=>{
  const {manager}=setup();let events=0;manager.subscribe(()=>{events++;const state=manager.getState();expect(state.activeSession.controller.getState().projection.inputRevision).toBe(state.document.scenarios.find(s=>s.id===state.document.activeScenarioId)!.plan.revision);});const editor=manager.getActiveSession().controller;edit(editor,'1.00');events=0;editor.saveRecord('household');expect(events).toBe(1);
  manager.forkScenario(manager.captureTarget('master')!,'Fork');const obsolete=manager.getActiveSession().controller;manager.deleteScenario(manager.captureTarget('fork')!);edit(obsolete,'20.00');expect(obsolete.saveRecord('household').accepted).toBe(false);expect(obsolete.getState().savedPlan.openingCashCents).toBe(100);
 });
 it('keeps failed writes global across switches and retries the entire envelope without revisions',()=>{
  const doc=makeScenarioWorkspace(),raw=exportWorkspace(doc),store=memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,raw]]));let fail=true;const manager=createScenarioManager(doc,{...store.port,setItem(key,value){if(fail)throw Error('quota');store.port.setItem(key,value);}},engine.loadRuleSet(),{persisted:true,persistenceIssues:[],observedRaw:raw,suspension:'none'},()=> 'fork');
  manager.forkScenario(manager.captureTarget('master')!,'Fork');manager.switchScenario('master');expect(manager.getActiveSession().controller.getState().persisted).toBe(false);const revision=manager.getState().document.workspaceRevision;fail=false;expect(manager.retryLocalSave().persisted).toBe(true);expect(manager.getState().document.workspaceRevision).toBe(revision);expect(JSON.parse(store.values.get(WORKSPACE_STORAGE_KEY)!).scenarios).toHaveLength(2);
 });
 it.each(['unreadable','external-change'] as const)('accepts local edits while %s suspension prevents all ordinary writes',suspension=>{const {manager,store}=setup(undefined,{suspension,persisted:false,observedRaw:undefined});edit(manager.getActiveSession().controller,'10.00');expect(manager.getActiveSession().controller.saveRecord('household').accepted).toBe(true);expect(manager.retryLocalSave().accepted).toBe(false);expect(store.writes()).toBe(0);});
 it('detects externally changed or cleared bytes and never retries over them',()=>{const {manager,store}=setup();manager.observeExternalStorage(null);expect(manager.getState().persistence.suspension).toBe('external-change');expect(manager.retryLocalSave().accepted).toBe(false);manager.forkScenario(manager.captureTarget('master')!,'Fork');expect(store.writes()).toBe(0);});
});
