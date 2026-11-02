import {it,expect} from 'vitest';
import {fireEvent,within,waitFor} from '@testing-library/dom';
import {mountScenarioWorkspace,setField} from '../helpers/dom';
import {makeScenarioWorkspace,memoryWorkspaceStorage} from '../helpers/scenarios';
import {WORKSPACE_STORAGE_KEY} from '../../src/browser/workspace-storage';

function openMenu(root:HTMLElement){fireEvent.click(within(root).getByLabelText('Scenario'));return within(root).getByRole('menu',{name:'Scenarios'});}
function click(root:HTMLElement,name:string){fireEvent.click(within(root).getByRole('button',{name}));}

it('adds and selects an exact copy through the dropdown while preserving source drafts',async()=>{
 const {root,manager}=mountScenarioWorkspace(makeScenarioWorkspace()),source=manager.getActiveSession();
 const draft=source.controller.getDraft('household','household');source.controller.editDraft('household',{...draft,value:{...draft.value,openingCashCents:'1.234'}});
 const menu=openMenu(root);fireEvent.click(within(menu).getByRole('menuitem',{name:'Add new scenario'}));
 const dialog=within(root).getByRole('dialog');expect(within(dialog).getByLabelText('Scenario name')).toHaveFocus();
 setField(dialog,'Scenario name','New possibility');click(dialog,'Create scenario');
 await waitFor(()=>expect(manager.getState().document.scenarios).toHaveLength(2));
 const state=manager.getState();expect(state.activeSession.scenarioId).not.toBe('master');
 expect(state.document.scenarios[1]!.plan).toEqual(state.document.scenarios[0]!.plan);
 expect(source.controller.getState().drafts.household?.value.openingCashCents).toBe('1.234');
 expect(within(root).getByLabelText('Scenario')).toHaveTextContent('New possibility');
 expect(within(root).getByLabelText('Scenario')).toHaveAccessibleDescription('New possibility');
 expect(within(root).getByLabelText('Scenario')).toHaveFocus();
});

it.each([1,2])('cancels deletion at confirmation %s without writes or lost drafts',async step=>{
 const doc=makeScenarioWorkspace(),store=memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,JSON.stringify(doc)]])),{root,manager}=mountScenarioWorkspace(doc,store.port);
 manager.forkScenario(manager.captureTarget('master')!,'Experiment');const session=manager.getActiveSession(),draft=session.controller.getDraft('household','household');
 session.controller.editDraft('household',{...draft,value:{...draft.value,openingCashCents:'1.234'}});
 const before=manager.getState().document,writes=store.writes(),menu=openMenu(root);
 fireEvent.click(within(menu).getByRole('menuitem',{name:'Delete Experiment'}));
 let dialog=within(root).getByRole('dialog',{name:'Delete Experiment'});
 expect(within(dialog).queryByRole('button',{name:'Delete scenario'})).toBeNull();
 if(step===2){click(dialog,'Continue');dialog=within(root).getByRole('dialog',{name:'Confirm deletion of Experiment'});}
 expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus();
 expect(manager.getState().document).toBe(before);expect(store.writes()).toBe(writes);
 fireEvent.keyDown(dialog,{key:'Escape'});
 expect(manager.getState().document).toBe(before);expect(store.writes()).toBe(writes);
 expect(session.controller.getState().drafts.household?.value.openingCashCents).toBe('1.234');
 expect(within(root).queryByRole('dialog')).toBeNull();expect(within(root).getByLabelText('Scenario')).toHaveFocus();
});

it('deletes the inactive row only after both confirmations and persists the surviving selection',async()=>{
 const doc=makeScenarioWorkspace(),store=memoryWorkspaceStorage(new Map([[WORKSPACE_STORAGE_KEY,JSON.stringify(doc)]])),{root,manager}=mountScenarioWorkspace(doc,store.port);
 manager.forkScenario(manager.captureTarget('master')!,'Experiment');const id=manager.getState().document.activeScenarioId;manager.switchScenario('master');
 const before=manager.getState().document,writes=store.writes(),session=manager.getActiveSession(),menu=openMenu(root);
 expect(within(menu).queryByRole('menuitem',{name:'Delete Master'})).toBeNull();
 fireEvent.click(within(menu).getByRole('menuitem',{name:'Delete Experiment'}));
 click(within(root).getByRole('dialog'),'Continue');
 expect(manager.getState().document).toBe(before);expect(store.writes()).toBe(writes);expect(manager.getActiveSession()).toBe(session);
 const final=within(root).getByRole('dialog',{name:'Confirm deletion of Experiment'});click(final,'Delete scenario');
 await waitFor(()=>expect(manager.captureTarget(id)).toBeUndefined());
 expect(manager.getActiveSession()).toBe(session);expect(store.writes()).toBe(writes+1);
 expect(JSON.parse(store.values.get(WORKSPACE_STORAGE_KEY)!)).toMatchObject({activeScenarioId:'master',scenarios:[{id:'master'}]});
 expect(within(root).getByLabelText('Scenario')).toHaveFocus();
});

it('invalidates the final confirmation when its workspace is replaced',()=>{
 const doc=makeScenarioWorkspace(),{root,manager}=mountScenarioWorkspace(doc);manager.forkScenario(manager.captureTarget('master')!,'Experiment');
 const menu=openMenu(root);fireEvent.click(within(menu).getByRole('menuitem',{name:'Delete Experiment'}));click(within(root).getByRole('dialog'),'Continue');
 const obsolete=within(root).getByRole('dialog');expect(manager.restoreWorkspace(manager.getState().document).accepted).toBe(true);
 expect(within(root).queryByRole('dialog')).toBeNull();click(obsolete,'Delete scenario');
 expect(manager.getState().document.scenarios).toHaveLength(2);
});

it('supports menu keyboard navigation, Escape, outside dismissal and protected renamed baseline',()=>{
 const {root,manager}=mountScenarioWorkspace(makeScenarioWorkspace());manager.renameScenario('master','Original');manager.forkScenario(manager.captureTarget('master')!,'Experiment');
 const trigger=within(root).getByLabelText('Scenario');trigger.focus();fireEvent.keyDown(trigger,{key:'ArrowDown'});
 const menu=within(root).getByRole('menu',{name:'Scenarios'}),first=within(menu).getAllByRole('menuitemradio')[0]!;
 expect(first).toHaveFocus();expect(within(menu).queryByRole('menuitem',{name:'Delete Original'})).toBeNull();
 fireEvent.keyDown(first,{key:'End'});expect(within(menu).getByRole('menuitem',{name:'Add new scenario'})).toHaveFocus();
 fireEvent.keyDown(menu,{key:'Escape'});expect(trigger).toHaveFocus();expect(trigger).toHaveAttribute('aria-expanded','false');
 openMenu(root);fireEvent.pointerDown(document.body);expect(trigger).toHaveAttribute('aria-expanded','false');
});
