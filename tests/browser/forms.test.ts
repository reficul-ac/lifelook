import {makeScenarioWorkspace} from '../helpers/scenarios';
import {exportWorkspace,WORKSPACE_STORAGE_KEY} from '../../src/browser/workspace-storage';
import {loadReferences} from '../helpers/references';
import type {PlanDocument,ProjectionResult} from '../../src/engine';
import { describe,expect,it,vi } from 'vitest';
import { fireEvent,within,waitFor } from '@testing-library/dom';
import { parseMoneyInput,parseRateInput,renderField,renderHistory,setAt,type FieldContext } from '../../src/browser/fields';
import { createWorkspace,toDraftValue } from '../../src/browser/state';
import { mountWorkspace,setField } from '../helpers/dom';
import { makePlan,mustValidate } from '../helpers/plans';
import { calculateProjection,loadRuleSet } from '../../src/engine';
import { startBrowserApp } from '../../src/browser/main';
import {openRecord,applyEdit,openSettings} from '../helpers/workspace-ui';

function storage(fail=false){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{if(fail)throw new Error('quota');values.set(key,value);}};}

function dateRefreshFixture(){
  const form=document.createElement('form'),body=document.createElement('div'),output=document.createElement('output');form.append(body,output);document.body.append(form);
  let draft={recordId:'date-interaction',section:'household' as const,value:{completionDate:'2028-02-28',availableDate:'2028-03-01'}};
  const context:FieldContext={get draft(){return draft;},issues:[],onChange(path,value){draft={...draft,value:setAt(draft.value,path,value) as typeof draft.value};},refresh(){const open=body.querySelector('details')?.open??false;body.replaceChildren();render(open);}};
  function render(open=false){
    renderField(body,context,['completionDate'],'Completion date',{kind:'date',refresh:true});
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Linked dates';details.open=open;details.append(summary);body.append(details);
    renderField(details,context,['availableDate'],'Available date',{kind:'date',refresh:true});
    const action=document.createElement('button');action.type='button';action.textContent='Use date';action.addEventListener('click',()=>{if(action.isConnected)output.textContent=draft.value.completionDate;});body.append(action);
  }
  render();return {form,body,output};
}

describe('native date structural refresh interactions',()=>{
  it('retains the next action through a held pointer and refreshes only after activation',async()=>{
    const {form,body,output}=dateRefreshFixture(),input=within(body).getByLabelText('Completion date') as HTMLInputElement,action=within(body).getByRole('button',{name:'Use date'});
    input.focus();fireEvent.input(input,{target:{value:'2028-02-29'}});fireEvent.pointerDown(action);action.focus();await Promise.resolve();
    expect(action.isConnected).toBe(true);expect(output).toBeEmptyDOMElement();
    fireEvent.pointerUp(action);fireEvent.click(action);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    await waitFor(()=>expect(output).toHaveTextContent('2028-02-29'));
    expect(within(form).getByLabelText('Completion date')).toHaveValue('2028-02-29');
  });
  it('keeps a keyboard-focused next action connected until it activates',async()=>{
    const {body,output}=dateRefreshFixture(),input=within(body).getByLabelText('Completion date') as HTMLInputElement,action=within(body).getByRole('button',{name:'Use date'});
    input.focus();fireEvent.input(input,{target:{value:'2028-02-29'}});fireEvent.keyDown(input,{key:'Tab'});action.focus();fireEvent.keyUp(action,{key:'Tab'});await Promise.resolve();
    expect(action.isConnected).toBe(true);expect(action).toHaveFocus();
    fireEvent.click(action);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));await waitFor(()=>expect(output).toHaveTextContent('2028-02-29'));
  });
  it('preserves the next focused native date and its unfinished value until it leaves',async()=>{
    const {body}=dateRefreshFixture(),first=within(body).getByLabelText('Completion date') as HTMLInputElement,second=within(body).getByLabelText('Available date') as HTMLInputElement;
    (second.closest('details') as HTMLDetailsElement).open=true;
    first.focus();fireEvent.input(first,{target:{value:'2028-02-29'}});second.focus();fireEvent.input(second,{target:{value:''}});await Promise.resolve();
    expect(within(body).getByLabelText('Available date')).toBe(second);expect(second).toHaveFocus();expect(second.value).toBe('');
    fireEvent.input(second,{target:{value:'2028-03-31'}});second.blur();
    await waitFor(()=>expect(within(body).getByLabelText('Available date')).toHaveValue('2028-03-31'));
  });
  it('keeps a disclosure opened by the next activation open through the refresh',async()=>{
    const {body}=dateRefreshFixture(),input=within(body).getByLabelText('Completion date') as HTMLInputElement,summary=within(body).getByText('Linked dates',{selector:'summary'});
    input.focus();fireEvent.input(input,{target:{value:'2028-02-29'}});fireEvent.pointerDown(summary);summary.focus();await Promise.resolve();
    fireEvent.pointerUp(summary);fireEvent.click(summary);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    await waitFor(()=>expect(within(body).getByText('Linked dates',{selector:'summary'}).parentElement).toHaveAttribute('open'));
    expect(within(body).getByLabelText('Completion date')).toHaveValue('2028-02-29');
  });
});

describe('native workspace drafts and explicit record saves',()=>{
  it.each(['checkbox','select','switch'] as const)('preserves Unknown / Yes / No histories with a %s presentation hint',kind=>{
    const root=document.createElement('section');document.body.append(root);
    let draft={recordId:'history',section:'household' as const,value:{qualified:{known:false}}};
    const context:FieldContext={get draft(){return draft;},issues:[],onChange(path,value){draft={...draft,value:setAt(draft.value,path,value) as typeof draft.value};},refresh(){}};
    renderHistory(root,context,['qualified'],'Qualified history',{kind});
    const control=within(root).getByRole('combobox',{name:'Qualified history'});
    expect(within(control).getAllByRole('option').map(option=>option.textContent)).toEqual(['Unknown','Yes','No']);
    expect(control).toHaveValue('unknown');
    fireEvent.change(control,{target:{value:'true'}});expect(draft.value.qualified).toEqual({known:true,value:true});
    fireEvent.change(control,{target:{value:'false'}});expect(draft.value.qualified).toEqual({known:true,value:false});
    fireEvent.change(control,{target:{value:'unknown'}});expect(draft.value.qualified).toEqual({known:false});
  });
  it.each(['checkbox','switch'] as const)('routes binary %s fields through native switch semantics without changing field identity',kind=>{
    const root=document.createElement('section');document.body.append(root);let checked=false;
    const context:FieldContext={draft:{recordId:'binary',section:'household',value:{enabled:false}},issues:[],onChange(_path,value){checked=value===true;},refresh(){}};
    const input=renderField(root,context,['enabled'],'Enabled',{kind});
    expect(within(root).getByRole('switch',{name:'Enabled'})).toBe(input);expect(input).toHaveAttribute('data-field','enabled');
    fireEvent.click(input);expect(checked).toBe(true);
  });
  it('commits binary changes before dependent fields refresh',()=>{
    const root=document.createElement('section');document.body.append(root);const events:string[]=[];
    root.addEventListener('financial-input-commit',()=>events.push('commit'));
    const context:FieldContext={draft:{recordId:'binary',section:'household',value:{enabled:false}},issues:[],onChange(){events.push('input');},refresh(){events.push('refresh');root.replaceChildren();}};
    const input=renderField(root,context,['enabled'],'Enabled',{kind:'switch',refresh:true});
    fireEvent.click(input);expect(events).toEqual(['input','commit','refresh']);
  });
  it('keeps keyboard focus on a history selector when its dependent field changes',async()=>{
    const {root}=mountWorkspace(makePlan());openRecord(root,{kind:'record',section:'household',recordId:'household'});const selector=within(root).getByLabelText('Filer 1 birth date history') as HTMLSelectElement;
    selector.focus();fireEvent.change(selector,{target:{value:'unknown'}});
    expect(document.activeElement).toBe(within(root).getByLabelText('Filer 1 birth date history'));
  });
  it('offers the original unreadable saved bytes for backup recovery without overwriting them',async()=>{
    const raw='{ original malformed financial backup',writes:string[]=[];let captured:Blob|undefined;
    vi.stubGlobal('URL',{createObjectURL:(blob:Blob)=>{captured=blob;return 'blob:backup';},revokeObjectURL:()=>{}});
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    try{
      const root=document.createElement('main');document.body.replaceChildren(root);const manager=startBrowserApp(root,{getItem:key=>key===WORKSPACE_STORAGE_KEY?raw:null,setItem:(_key,value)=>{writes.push(value);}}),controller=manager.getActiveSession().controller;
      expect(controller.getState().persisted).toBe(false);expect(writes).toEqual([]);
      fireEvent.click(within(within(root).getByTestId('persistence-warning')).getByRole('button',{name:'Download unreadable saved backup'}));
      expect(captured).toBeDefined();
      const bytes=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.addEventListener('load',()=>resolve(String(reader.result)));reader.addEventListener('error',()=>reject(reader.error));reader.readAsText(captured!);});
      expect(bytes).toBe(raw);expect(writes).toEqual([]);
    }finally{click.mockRestore();vi.unstubAllGlobals();}
  });
  it('parses entered decimal units without silently rounding',async()=>{
    expect(parseMoneyInput('1.23')).toEqual({status:'available',value:123});expect(parseMoneyInput('1.234').status).toBe('needs-data');expect(parseRateInput('7.00')).toEqual({status:'available',value:700});expect(parseRateInput('7.001').status).toBe('needs-data');expect(parseMoneyInput('').status).toBe('needs-data');
    for(const invalid of ['Infinity','NaN','1e3','0x10','1,200','1.'])expect(parseMoneyInput(invalid).status).toBe('needs-data');
  });
  it('invalid draft retains saved input revision',async()=>{
    const {root,controller}=mountWorkspace(makePlan());openRecord(root,{kind:'record',section:'household',recordId:'household'});
    setField(root,'Opening cash reserve ($)','1.234');
    await applyEdit(root);
    const state=controller.getState();
    expect(state.drafts.household?.value.openingCashCents).toBe('1.234');
    expect(state.savedPlan.revision).toBe(0);expect(state.projection.inputRevision).toBe(0);
    expect(within(root).getByTestId('save-status')).toHaveTextContent('Applied · Saved locally');fireEvent.click(within(root.querySelector('[data-form-feedback]')!).getByRole('button',{name:/Details: Opening cash reserve/}));expect(document.querySelector('[data-disclosure-panel]')).toHaveTextContent('openingCashCents');
    expect(within(root).getByLabelText('Opening cash reserve ($)')).toHaveValue('1.234');
  });
  it('saves household factual and tax-policy inputs together in one revision',async()=>{
    const {root,controller}=mountWorkspace(makePlan());openRecord(root,{kind:'record',section:'household',recordId:'household'});
    setField(root,'Opening cash reserve ($)','125.50');setField(root,'Future tax threshold growth (%)','2.00');setField(root,'Projection years','2');
    await applyEdit(root);
    const state=controller.getState();expect(state.savedPlan.revision).toBe(1);expect(state.savedPlan.openingCashCents).toBe(12550);expect(state.savedPlan.taxPolicy.futureIndexGrowthBps).toBe(200);expect(state.projection.inputRevision).toBe(1);expect(state.persisted).toBe(true);
    expect(state.projection).toEqual(calculateProjection(mustValidate(state.savedPlan),loadRuleSet()));
  });
  it('failed save retains exportable in-memory revision',async()=>{
    const {root,controller}=mountWorkspace(makePlan(),storage(true));openRecord(root,{kind:'record',section:'household',recordId:'household'});
    setField(root,'Opening cash reserve ($)','10.00');await applyEdit(root);
    const state=controller.getState();expect(state.savedPlan.revision).toBe(1);expect(state.projection.inputRevision).toBe(1);expect(state.persisted).toBe(false);expect(root).toHaveTextContent('Not saved locally');
    expect(JSON.parse(controller.exportBackup()).revision).toBe(1);
  });
  it('keeps raw nested rows independently until their owning record saves',async()=>{
    const controller=createWorkspace(makePlan(),storage(),loadRuleSet());
    const id=controller.beginAdd('salaries');const draft=controller.getDraft('salaries',id);
    controller.editDraft(id,{...draft,value:{...draft.value,name:'Salary A',annualGrossCents:'60000.00',changes:[{date:'2026-06-15',kind:'percent',percentBps:'5.00'},{date:'2026-09-01',kind:'amount',annualGrossCents:'65000.00'}]}});
    expect(controller.getState().savedPlan.salaries).toEqual([]);expect(controller.getState().projection.inputRevision).toBe(0);
    expect(controller.saveRecord(id).accepted).toBe(true);expect(controller.getState().savedPlan.salaries[0]?.changes).toEqual([{date:'2026-06-15',kind:'percent',percentBps:500},{date:'2026-09-01',kind:'amount',annualGrossCents:6500000}]);
  });
  it('rejects a referenced record deletion without silently removing its dependent records',async()=>{
    const base=makePlan({accounts:[{id:'broker',name:'Broker',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'deposit',accountId:'broker',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}]});
    const controller=createWorkspace(base,storage(),loadRuleSet());expect(controller.removeRecord('accounts','broker').accepted).toBe(false);expect(controller.getState().savedPlan.accounts).toHaveLength(1);expect(controller.getState().savedPlan.contributions).toHaveLength(1);expect(controller.getState().savedPlan.revision).toBe(0);
  });
  it('round-trips dollar/rate/history draft units without changing original inputs',async()=>{
    const raw=toDraftValue({openingBalance:{known:true,value:12345},openingIraBasis:{known:false},aprBps:700,termMonths:360});expect(raw).toEqual({openingBalance:{known:true,value:'123.45'},openingIraBasis:{known:false},aprBps:'7.00',termMonths:'360'});
  });
  it('retains native input focus and selection while editing a draft',async()=>{
    const {root}=mountWorkspace(makePlan());openRecord(root,{kind:'record',section:'household',recordId:'household'});const input=within(root).getByLabelText('Opening cash reserve ($)') as HTMLInputElement;input.focus();input.setSelectionRange(1,1);fireEvent.input(input,{target:{value:'123.45'}});expect(document.activeElement).toBe(input);expect(within(root).getByLabelText('Opening cash reserve ($)')).toBe(input);
  });
});

describe('collapsed property history in the mounted workspace',()=>{
  function propertyWorkspace(){const plan=loadReferences<PlanDocument,ProjectionResult>('projection').find(c=>c.id==='two-salaries-home-adu')!.input;const mounted=mountWorkspace(plan);openRecord(mounted.root,{kind:'record',section:'properties',recordId:'home'});const form=[...mounted.root.querySelectorAll<HTMLElement>('form')].find(node=>node.dataset.recordId==='home')!;return {...mounted,form,plan};}
  it('starts saved advanced history closed and preserves deliberate opens through unrelated saves',async()=>{
    const {root,form,controller,plan}=propertyWorkspace();fireEvent.click(within(form).getByRole('button',{name:'Rent & costs'}));const details=[...form.querySelectorAll('details')];expect(details.length).toBeGreaterThan(0);expect(details.every(node=>!node.open)).toBe(true);
    const rental=within(form).getByText(/^Rental unit —/,{selector:'summary'}).parentElement as HTMLDetailsElement;rental.open=true;
    const summary=within(form).getByText(/^Federal AMT history/,{selector:'summary'});fireEvent.click(summary);const input=[...form.querySelectorAll<HTMLInputElement>('input[data-field]')].find(node=>node.dataset.field==='rentals.0.taxHistory.federal-amt.value.adjustedBuildingBasisCents')!;
    fireEvent.input(input,{target:{value:'40000.00'}});const salary=plan.salaries[0]!,draft=controller.getDraft('salaries',salary.id);controller.editDraft(salary.id,{...draft,value:{...draft.value,name:'Renamed salary'}});controller.saveRecord(salary.id);
    const newForm=[...root.querySelectorAll('form')].find(node=>node.dataset.recordId==='home')!;expect((within(newForm).getByText(/^Federal AMT history/,{selector:'summary'}).parentElement as HTMLDetailsElement).open).toBe(true);expect(controller.getState().drafts.home).toBeDefined();
  });
  it('reveals and focuses the hidden invalid AMT field without replacing it or applying other books',async()=>{
    const {form,controller,plan}=propertyWorkspace();fireEvent.click(within(form).getByRole('button',{name:'Rent & costs'}));for(const details of form.querySelectorAll('details'))if(!details.open)fireEvent.click(details.querySelector('summary')!);
    const input=[...form.querySelectorAll<HTMLInputElement>('input[data-field]')].find(node=>node.dataset.field==='rentals.0.taxHistory.federal-amt.value.adjustedBuildingBasisCents')!;
    fireEvent.input(input,{target:{value:'1.234'}});const ancestors:HTMLDetailsElement[]=[];for(let node:HTMLElement|null=input.parentElement;node;node=node.parentElement)if(node instanceof HTMLDetailsElement)ancestors.push(node);
    for(const details of ancestors)if(details.open)fireEvent.click(details.querySelector('summary')!);await applyEdit(form);
    expect(input).toHaveValue('1.234');expect(input).toHaveAttribute('aria-invalid','true');expect(ancestors.every(node=>node.open)).toBe(true);expect(controller.getState().savedPlan.revision).toBe(0);expect(controller.getState().savedPlan.rentals[0]!.taxHistory.california).toEqual(plan.rentals[0]!.taxHistory.california);
    expect(within(form).getByText(/^Federal AMT history/,{selector:'summary'})).toHaveTextContent('1 input error');fireEvent.click(within(form.querySelector('[data-form-feedback]')!).getByRole('button',{name:'Review Adjusted building basis ($)'}));expect(input).toHaveFocus();
  });
  it('opens new loan sections for entry while distinguishing known-zero history from unknown',async()=>{
    const {form}=propertyWorkspace();fireEvent.click(within(form).getByRole('button',{name:'Financing'}));fireEvent.click(within(form).getByText('Add loan',{selector:'button'}));
    expect((within(form).getByText(/Loan — Purchase loan/,{selector:'summary'}).parentElement as HTMLDetailsElement).open).toBe(true);
  });
  it('keeps collapsed rental summary facts current and preserves confirmed zero',()=>{
    const {form}=propertyWorkspace();fireEvent.click(within(form).getByRole('button',{name:'Rent & costs'}));for(const details of form.querySelectorAll('details'))if(!details.open)fireEvent.click(details.querySelector('summary')!);
    setField(form,'QBI qualification','unknown');expect(within(form).getByText(/^QBI history/,{selector:'summary'})).toHaveTextContent('1 unknown fact');
    let federal=within(form).getByText(/^Federal history/,{selector:'summary'}).parentElement!;setField(federal,'History status','known-zero');
    federal=within(form).getByText(/^Federal history/,{selector:'summary'}).parentElement!;expect(federal.querySelector('summary')).toHaveTextContent('Confirmed zero');
    setField(federal,'Adjusted building basis ($)','1.00');expect(federal.querySelector('summary')).toHaveTextContent('Entered amounts');
  });
  it('marks opening loan amounts unavailable while the exact APR is invalid',()=>{
    const {form}=propertyWorkspace();fireEvent.click(within(form).getByRole('button',{name:'Financing'}));
    setField(form,'Nominal APR (%)','1.234');expect(within(form).getByText(/^Loan —/,{selector:'summary'})).toHaveTextContent('Opening inputs unavailable');
  });
  it('keeps the valuation date and combined home/ADU scope beside the entered amount',async()=>{
    const {form}=propertyWorkspace();const input=form.querySelector<HTMLElement>('[data-field="property.openingValueCents"]')!;expect(input).toHaveAccessibleName('Combined home and ADU market value at forecast start ($)');expect(input).toHaveAccessibleDescription('As of Jan 1, 2026. Includes the home and ADU together.');
  });
});

describe('recovery shell and meaningful announcements',()=>{
  it('announces operations without announcing keystrokes and keeps recovery export outside closed backups',async()=>{
    const {root,controller}=mountWorkspace(makePlan(),storage(true)),announcement=within(root).getByTestId('save-announcement');const mutations:MutationRecord[]=[];const observer=new MutationObserver(records=>mutations.push(...records));observer.observe(announcement,{childList:true,subtree:true,characterData:true});
    openRecord(root,{kind:'record',section:'household',recordId:'household'});setField(root,'Opening cash reserve ($)','10.00');await Promise.resolve();expect(mutations).toEqual([]);await applyEdit(root);await Promise.resolve();expect(mutations.length).toBeGreaterThan(0);expect(announcement).toHaveTextContent('Changes applied.');
    setField(root,'Opening cash reserve ($)','123.45');expect(within(root).getByTestId('persistence-warning')).toBeVisible();expect(within(within(root).getByTestId('persistence-warning')).getByRole('button',{name:'Export workspace backup'})).toBeVisible();expect(JSON.parse(controller.exportBackup()).openingCashCents).toBe(1000);
    expect(within(root).getByTestId('save-status')).toHaveTextContent('Applied · Not saved locally');expect(within(root).getByTestId('draft-status')).toHaveTextContent(/draft.*not applied/);observer.disconnect();
  });
  it.each(['{',JSON.stringify({...makePlan(),schemaVersion:2})])('retains startup recovery for rejected documents through editing: %s',async raw=>{
    const root=document.createElement('main');document.body.replaceChildren(root);const manager=startBrowserApp(root,{getItem:key=>key===WORKSPACE_STORAGE_KEY?raw:null,setItem:()=>{}}),controller=manager.getActiveSession().controller;expect(within(root).getByTestId('persistence-warning')).toBeVisible();expect(controller.getState().persistenceIssues.length).toBeGreaterThan(0);
    openRecord(root,{kind:'record',section:'household',recordId:'household'});setField(root,'Opening cash reserve ($)','1.234');await applyEdit(root);expect(within(root).getByTestId('persistence-warning')).toBeVisible();expect(within(within(root).getByTestId('persistence-warning')).getByRole('button',{name:'Download unreadable saved backup'})).toBeVisible();
  });
  it('distinguishes first use, valid incomplete loaded inputs and failed reads',async()=>{
    for(const [getItem,want]of [[()=>null,false],[()=>exportWorkspace(makeScenarioWorkspace({...makePlan(),household:{...makePlan().household,coverageAnswers:{...makePlan().household.coverageAnswers,additionalIncome:{known:false}}}})),false],[()=>{throw new Error('blocked');},true]] as const){
      const root=document.createElement('main');document.body.replaceChildren(root);const manager=startBrowserApp(root,{getItem,setItem:()=>{}}),controller=manager.getActiveSession().controller;expect(controller.getState().persistenceIssues.length>0).toBe(want);expect(within(root).getByTestId('persistence-warning').hidden).toBe(!want);
    }
  });
  it('associates backup replacement and draft exclusion consequences before selection',async()=>{
    const {root}=mountWorkspace(makePlan());openSettings(root);fireEvent.click(within(root).getByText('Backups and recovery',{selector:'summary'}));
    expect(within(root).getByLabelText('Replace this scenario from JSON')).toHaveAccessibleDescription("Replaces Master's applied inputs and unfinished edits after confirmation.");expect(root).toHaveTextContent('Exports applied inputs. Record and allocation drafts are excluded.');
  });
  it('keeps drafts on malformed import and initializes durable failures for an accepted memory-only restore',async()=>{
    const {root,controller,manager}=mountWorkspace(makePlan(),storage(true));openRecord(root,{kind:'record',section:'household',recordId:'household'});setField(root,'Opening cash reserve ($)','77.77');const before=controller.getState();
    openSettings(root);fireEvent.click(within(root).getByText('Backups and recovery',{selector:'summary'}));const input=within(root).getByLabelText('Replace this scenario from JSON');
    fireEvent.change(input,{target:{files:[new File(['{'],'bad.json',{type:'application/json'})]}});await waitFor(()=>expect(root).toHaveTextContent('Backup not restored.'));
    expect(controller.getState().savedPlan).toBe(before.savedPlan);expect(controller.getState().drafts).toEqual(before.drafts);expect(controller.getState().persistenceIssues).toEqual(before.persistenceIssues);
    const replacement=makePlan({revision:8,openingCashCents:8800});fireEvent.change(input,{target:{files:[new File([JSON.stringify(replacement)],'valid.json',{type:'application/json'})]}});await waitFor(()=>expect(within(root).getByRole('dialog',{name:'Replace Master'})).toBeVisible());fireEvent.click(within(within(root).getByRole('dialog')).getByRole('button',{name:'Replace scenario'}));const replacementController=manager.getActiveSession().controller;expect(replacementController.getState().savedPlan.revision).toBe(8);
    expect(replacementController.getState().drafts).toEqual({});expect(replacementController.getState().persistenceIssues).toContainEqual(expect.objectContaining({code:'storage-write-failed'}));openRecord(root,{kind:'record',section:'household',recordId:'household'});setField(root,'Opening cash reserve ($)','99.99');expect(within(within(root).getByTestId('persistence-warning')).getByRole('button',{name:'Export workspace backup'})).toBeVisible();expect(JSON.parse(replacementController.exportBackup()).openingCashCents).toBe(8800);
  });
});
