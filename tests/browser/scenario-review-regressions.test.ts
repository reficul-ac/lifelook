import {afterEach, expect, it, vi} from 'vitest';
import {fireEvent, waitFor, within} from '@testing-library/dom';
import {loadRuleSet} from '../../src/engine';
import {createScenarioManager} from '../../src/browser/scenario-manager';
import {mountScenarioApp} from '../../src/browser/scenario-app';
import {unmountApp} from '../../src/browser/main';
import {WORKSPACE_STORAGE_KEY} from '../../src/browser/workspace-storage';
import {mountScenarioWorkspace, setField} from '../helpers/dom';
import {makeAllocationPlan} from '../helpers/allocations';
import {makePlan, mustValidate} from '../helpers/plans';
import {makeScenarioWorkspace, memoryWorkspaceStorage} from '../helpers/scenarios';

const click=(root:HTMLElement,name:string)=>fireEvent.click(within(root).getByRole('button',{name}));
afterEach(()=>{for(const root of document.querySelectorAll<HTMLElement>('.workspace'))unmountApp(root);vi.restoreAllMocks();vi.unstubAllGlobals();});

it.each(['discard','apply','saved input'] as const)('reconciles allocation preview after inactive %s',async action=>{
 const {root,manager}=mountScenarioWorkspace(makeScenarioWorkspace(makeAllocationPlan()));
 click(root,'Investments');click(root,'Add allocation');setField(root,'Allocation percentage (%)','20.00');
 await waitFor(()=>expect(root.querySelector('[data-allocation-remaining]')).toHaveTextContent('80.00%'));
 const source=manager.getActiveSession();
 if(action==='saved input')expect(source.controller.applyAllocation().accepted).toBe(true);
 manager.forkScenario(manager.captureTarget('master')!,'Fork');
 if(action==='discard')source.controller.discardAllocationDraft();
 if(action==='apply')expect(source.controller.applyAllocation().accepted).toBe(true);
 if(action==='saved input'){
  const draft=source.controller.getDraft('salaries','salary-a');
  source.controller.editDraft('salary-a',{...draft,value:{...draft.value,annualGrossCents:'50000.00'}});
  expect(source.controller.saveRecord('salary-a').accepted).toBe(true);
 }
 const state=source.controller.getState();
 expect(source.view.allocationPreview.lastValid?.plan).toBe(state.savedPlan);
 expect(source.view.allocationPreview.lastValid?.projection).toBe(state.projection);
 manager.switchScenario('master');
 expect(root.querySelector('[data-allocation-status]')).toHaveTextContent('Applied allocation');
 expect(root.querySelector('[data-allocation-remaining]')).toHaveTextContent(action==='discard'?'100.00%':'80.00%');
});

it.each(['edit','save','discard'] as const)('clears only relevant retained feedback after inactive household %s',action=>{
 const {root,manager}=mountScenarioWorkspace(makeScenarioWorkspace());
 setField(root,'Opening cash reserve ($)','1.234');click(root,'Save household');
 const source=manager.getActiveSession(),unrelated=[{code:'invalid-input',recordId:'other',severity:'error' as const,explanation:'Other error',resolution:'Correct it'}];
 source.view.taskIssues.set('other',unrelated);
 manager.forkScenario(manager.captureTarget('master')!,'Fork');
 if(action==='discard')source.controller.discardDraft('household');
 else{
  const draft=source.controller.getDraft('household','household');
  source.controller.editDraft('household',{...draft,value:{...draft.value,openingCashCents:'12.34'}});
  if(action==='save')expect(source.controller.saveRecord('household').accepted).toBe(true);
 }
 expect(source.view.taskIssues.has('household')).toBe(false);
 expect(source.view.taskIssues.get('other')).toBe(unrelated);
 manager.switchScenario('master');
 expect(within(root).getByLabelText('Opening cash reserve ($)')).not.toHaveAttribute('aria-invalid','true');
});

it('captures inactive failed saves and removals and clears each after relevant edits',()=>{
 const plan=makeAllocationPlan({contributions:[{id:'deposit',accountId:'brokerage',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100}}]});
 const {manager}=mountScenarioWorkspace(makeScenarioWorkspace(plan)),source=manager.getActiveSession();
 manager.forkScenario(manager.captureTarget('master')!,'Fork');
 const household=source.controller.getDraft('household','household');
 source.controller.editDraft('household',{...household,value:{...household.value,openingCashCents:'1.234'}});
 expect(source.controller.saveRecord('household').accepted).toBe(false);
 expect(source.controller.removeRecord('accounts','brokerage').accepted).toBe(false);
 expect(source.view.taskIssues.get('household')).toEqual(expect.arrayContaining([expect.objectContaining({code:'invalid-input'})]));
 expect(source.view.removeIssues.get('brokerage')?.length).toBeGreaterThan(0);
 source.controller.discardDraft('household');
 expect(source.view.taskIssues.has('household')).toBe(false);
 expect(source.view.removeIssues.get('brokerage')?.length).toBeGreaterThan(0);
 const account=source.controller.getDraft('accounts','brokerage');
 source.controller.editDraft('brokerage',{...account,value:{...account.value,name:'Edited stocks'}});
 expect(source.view.removeIssues.has('brokerage')).toBe(false);
});

it.each([
 ['fork','frame','Escape'],['fork','timer','Escape'],['delete','frame','Escape'],['delete','timer','Escape'],
 ['fork','frame','native cancel'],['delete','frame','native cancel'],['delete','timer','Cancel'],
] as const)('cancels queued %s during %s through %s',async(kind,stage,cancellation)=>{
 const doc=makeScenarioWorkspace(),store=memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,JSON.stringify(doc)]]));
 const {root,manager}=mountScenarioWorkspace(doc,store.port);
 if(kind==='delete')manager.forkScenario(manager.captureTarget('master')!,'Experiment');
 const source=manager.getActiveSession();setField(root,'Opening cash reserve ($)','1.234');
 const frames=new Map<number,FrameRequestCallback>();let frameId=0;
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++frameId,callback);return frameId;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 if(kind==='fork')click(root,'Fork scenario');
 else{fireEvent.click(within(root).getByText('Manage scenarios',{selector:'summary'}));click(root,'Delete Experiment');}
 const dialog=within(root).getByRole('dialog'),before=manager.getState().document,writes=store.writes();
 click(dialog,kind==='fork'?'Create scenario':'Delete scenario');
 if(stage==='timer'){const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(0));}
 if(cancellation==='Escape')fireEvent.keyDown(dialog,{key:'Escape'});
 else if(cancellation==='native cancel')fireEvent(dialog,new Event('cancel',{cancelable:true}));
 else click(dialog,'Cancel');
 const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(0));
 await new Promise(resolve=>setTimeout(resolve,30));
 expect(manager.getState().document).toBe(before);expect(store.writes()).toBe(writes);
 expect(manager.getActiveSession()).toBe(source);expect(source.controller.getState().drafts.household?.value.openingCashCents).toBe('1.234');
 expect(within(root).queryByRole('dialog')).toBeNull();expect(root).not.toHaveAttribute('aria-busy','true');
 expect(within(root).getByRole('button',{name:'Fork scenario'})).toBeEnabled();
 expect(kind==='fork'?within(root).getByRole('button',{name:'Fork scenario'}):within(root).getByRole('button',{name:'Delete Experiment'})).toHaveFocus();
});

it('keeps pending recovery retry available after read failure without losing current drafts',()=>{
 const raw='unreadable',store=memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,raw]]));let readsFail=false,writesFail=true;
 const manager=createScenarioManager(makeScenarioWorkspace(),{getItem(key){if(readsFail)throw Error('read');return store.port.getItem(key);},setItem(key,value){if(writesFail)throw Error('quota');store.port.setItem(key,value);}},loadRuleSet(),{persisted:false,persistenceIssues:[],observedRaw:raw,suspension:'unreadable',recovery:{key:WORKSPACE_STORAGE_KEY,raw}},()=> 'recovered');
 const root=document.createElement('main');document.body.replaceChildren(root);mountScenarioApp(root,manager);
 expect(manager.replaceUnreadableData({kind:'plan',plan:mustValidate(makePlan({openingCashCents:9900}))})).toMatchObject({accepted:true,persisted:false});
 fireEvent.click(within(root).getByText('Backups and recovery',{selector:'summary'}));
 setField(root,'Opening cash reserve ($)','1.234');const source=manager.getActiveSession(),before=manager.getState().document;
 readsFail=true;click(root,'Retry unreadable data replacement');
 expect(manager.getState().persistence.persistenceIssues).toEqual(expect.arrayContaining([expect.objectContaining({code:'storage-read-failed'})]));
 expect(within(root).getByRole('button',{name:'Retry unreadable data replacement'})).toBeEnabled();
 readsFail=false;writesFail=false;click(root,'Retry unreadable data replacement');
 expect(manager.getState().persistence.suspension).toBe('none');expect(manager.getState().document).toBe(before);
 expect(manager.getActiveSession()).toBe(source);expect(source.controller.getState().drafts.household?.value.openingCashCents).toBe('1.234');
 expect(store.writes()).toBe(1);expect(manager.getState().persistence.recovery?.raw).toBe(raw);
 expect(within(root).queryByRole('button',{name:'Retry unreadable data replacement'})).toBeNull();
});
