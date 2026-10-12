import {loadReferences} from '../helpers/references';
import type {PlanDocument,ProjectionResult} from '../../src/engine';
import { describe,expect,it,vi } from 'vitest';
import { fireEvent,within } from '@testing-library/dom';
import { parseMoneyInput,parseRateInput } from '../../src/browser/fields';
import { createWorkspace,toDraftValue } from '../../src/browser/state';
import { mountWorkspace,setField } from '../helpers/dom';
import { makePlan,mustValidate } from '../helpers/plans';
import { calculateProjection,loadRuleSet } from '../../src/engine';
import { startBrowserApp } from '../../src/browser/main';

function storage(fail=false){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{if(fail)throw new Error('quota');values.set(key,value);}};}
describe('native workspace drafts and explicit record saves',()=>{
  it('keeps keyboard focus on a history selector when its dependent field changes',()=>{
    const {root}=mountWorkspace(makePlan());const selector=within(root).getByLabelText('Filer 1 birth date history') as HTMLSelectElement;
    selector.focus();fireEvent.change(selector,{target:{value:'unknown'}});
    expect(document.activeElement).toBe(within(root).getByLabelText('Filer 1 birth date history'));
  });
  it('offers the original unreadable saved bytes for backup recovery without overwriting them',async()=>{
    const raw='{ original malformed financial backup',writes:string[]=[];let captured:Blob|undefined;
    vi.stubGlobal('URL',{createObjectURL:(blob:Blob)=>{captured=blob;return 'blob:backup';},revokeObjectURL:()=>{}});
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    try{
      const root=document.createElement('main');document.body.replaceChildren(root);const controller=startBrowserApp(root,{getItem:()=>raw,setItem:(_key,value)=>{writes.push(value);}});
      expect(controller.getState().persisted).toBe(false);expect(writes).toEqual([]);
      fireEvent.click(within(root.querySelector('header details') as HTMLElement).getByRole('button',{name:'Download unreadable saved backup',hidden:true}));
      expect(captured).toBeDefined();
      const bytes=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.addEventListener('load',()=>resolve(String(reader.result)));reader.addEventListener('error',()=>reject(reader.error));reader.readAsText(captured!);});
      expect(bytes).toBe(raw);expect(writes).toEqual([]);
    }finally{click.mockRestore();vi.unstubAllGlobals();}
  });
  it('parses entered decimal units without silently rounding',()=>{
    expect(parseMoneyInput('1.23')).toEqual({status:'available',value:123});expect(parseMoneyInput('1.234').status).toBe('needs-data');expect(parseRateInput('7.00')).toEqual({status:'available',value:700});expect(parseRateInput('7.001').status).toBe('needs-data');expect(parseMoneyInput('').status).toBe('needs-data');
    for(const invalid of ['Infinity','NaN','1e3','0x10','1,200','1.'])expect(parseMoneyInput(invalid).status).toBe('needs-data');
  });
  it('invalid draft retains saved input revision',()=>{
    const {root,controller}=mountWorkspace(makePlan());
    setField(root,'Opening cash reserve ($)','1.234');
    fireEvent.click(within(root).getByRole('button',{name:'Save household'}));
    const state=controller.getState();
    expect(state.drafts.household?.value.openingCashCents).toBe('1.234');
    expect(state.savedPlan.revision).toBe(0);expect(state.projection.inputRevision).toBe(0);
    expect(root).toHaveTextContent('Saved input revision 0');fireEvent.click(within(root).getByRole('button',{name:/Enter money as an ordinary decimal/}));expect(document.querySelector('[data-disclosure-panel]')).toHaveTextContent('openingCashCents');
    expect(within(root).getByLabelText('Opening cash reserve ($)')).toHaveValue('1.234');
  });
  it('saves household factual and tax-policy inputs together in one revision',()=>{
    const {root,controller}=mountWorkspace(makePlan());
    setField(root,'Opening cash reserve ($)','125.50');setField(root,'Future tax threshold growth (%)','2.00');setField(root,'Projection years','2');
    fireEvent.click(within(root).getByRole('button',{name:'Save household'}));
    const state=controller.getState();expect(state.savedPlan.revision).toBe(1);expect(state.savedPlan.openingCashCents).toBe(12550);expect(state.savedPlan.taxPolicy.futureIndexGrowthBps).toBe(200);expect(state.projection.inputRevision).toBe(1);expect(state.persisted).toBe(true);
    expect(state.projection).toEqual(calculateProjection(mustValidate(state.savedPlan),loadRuleSet()));
  });
  it('failed save retains exportable in-memory revision',()=>{
    const {root,controller}=mountWorkspace(makePlan(),storage(true));
    setField(root,'Opening cash reserve ($)','10.00');fireEvent.click(within(root).getByRole('button',{name:'Save household'}));
    const state=controller.getState();expect(state.savedPlan.revision).toBe(1);expect(state.projection.inputRevision).toBe(1);expect(state.persisted).toBe(false);expect(root).toHaveTextContent('Unsaved');
    expect(JSON.parse(controller.exportBackup()).revision).toBe(1);
  });
  it('keeps raw nested rows independently until their owning record saves',()=>{
    const controller=createWorkspace(makePlan(),storage(),loadRuleSet());
    const id=controller.beginAdd('salaries');const draft=controller.getDraft('salaries',id);
    controller.editDraft(id,{...draft,value:{...draft.value,name:'Salary A',annualGrossCents:'60000.00',changes:[{date:'2026-06-15',kind:'percent',percentBps:'5.00'},{date:'2026-09-01',kind:'amount',annualGrossCents:'65000.00'}]}});
    expect(controller.getState().savedPlan.salaries).toEqual([]);expect(controller.getState().projection.inputRevision).toBe(0);
    expect(controller.saveRecord(id).accepted).toBe(true);expect(controller.getState().savedPlan.salaries[0]?.changes).toEqual([{date:'2026-06-15',kind:'percent',percentBps:500},{date:'2026-09-01',kind:'amount',annualGrossCents:6500000}]);
  });
  it('rejects a referenced record deletion without silently removing its dependent records',()=>{
    const base=makePlan({accounts:[{id:'broker',name:'Broker',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}}],contributions:[{id:'deposit',accountId:'broker',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}]});
    const controller=createWorkspace(base,storage(),loadRuleSet());expect(controller.removeRecord('accounts','broker').accepted).toBe(false);expect(controller.getState().savedPlan.accounts).toHaveLength(1);expect(controller.getState().savedPlan.contributions).toHaveLength(1);expect(controller.getState().savedPlan.revision).toBe(0);
  });
  it('round-trips dollar/rate/history draft units without changing original inputs',()=>{
    const raw=toDraftValue({openingBalance:{known:true,value:12345},openingIraBasis:{known:false},aprBps:700,termMonths:360});expect(raw).toEqual({openingBalance:{known:true,value:'123.45'},openingIraBasis:{known:false},aprBps:'7.00',termMonths:'360'});
  });
  it('retains native input focus and selection while editing a draft',()=>{
    const {root}=mountWorkspace(makePlan());const input=within(root).getByLabelText('Opening cash reserve ($)') as HTMLInputElement;input.focus();input.setSelectionRange(1,1);fireEvent.input(input,{target:{value:'123.45'}});expect(document.activeElement).toBe(input);expect(within(root).getByLabelText('Opening cash reserve ($)')).toBe(input);
  });
});

describe('collapsed property history in the mounted workspace',()=>{
  function propertyWorkspace(){const plan=loadReferences<PlanDocument,ProjectionResult>('projection').find(c=>c.id==='two-salaries-home-adu')!.input;const mounted=mountWorkspace(plan);fireEvent.click(within(mounted.root.querySelector('nav')!).getByRole('button',{name:'Properties'}));const form=[...mounted.root.querySelectorAll<HTMLElement>('form')].find(node=>node.dataset.recordId==='home')!;return {...mounted,form,plan};}
  it('starts saved advanced history closed and preserves deliberate opens through unrelated saves',()=>{
    const {root,form,controller,plan}=propertyWorkspace();const details=[...form.querySelectorAll('details')];expect(details).toHaveLength(8);expect(details.every(node=>!node.open)).toBe(true);
    const rental=within(form).getByText(/^Rental unit —/,{selector:'summary'}).parentElement as HTMLDetailsElement;rental.open=true;
    const summary=within(form).getByText(/^Federal AMT history/,{selector:'summary'});fireEvent.click(summary);const input=[...form.querySelectorAll<HTMLInputElement>('input[data-field]')].find(node=>node.dataset.field==='rentals.0.taxHistory.federal-amt.value.adjustedBuildingBasisCents')!;
    fireEvent.input(input,{target:{value:'40000.00'}});const salary=plan.salaries[0]!,draft=controller.getDraft('salaries',salary.id);controller.editDraft(salary.id,{...draft,value:{...draft.value,name:'Renamed salary'}});controller.saveRecord(salary.id);
    const newForm=[...root.querySelectorAll('form')].find(node=>node.dataset.recordId==='home')!;expect((within(newForm).getByText(/^Federal AMT history/,{selector:'summary'}).parentElement as HTMLDetailsElement).open).toBe(true);expect(controller.getState().drafts.home).toBeDefined();
  });
  it('reveals and focuses the hidden invalid AMT field without replacing it or applying other books',()=>{
    const {form,controller,plan}=propertyWorkspace();for(const details of form.querySelectorAll('details'))if(!details.open)fireEvent.click(details.querySelector('summary')!);
    const input=[...form.querySelectorAll<HTMLInputElement>('input[data-field]')].find(node=>node.dataset.field==='rentals.0.taxHistory.federal-amt.value.adjustedBuildingBasisCents')!;
    fireEvent.input(input,{target:{value:'1.234'}});const ancestors:HTMLDetailsElement[]=[];for(let node:HTMLElement|null=input.parentElement;node;node=node.parentElement)if(node instanceof HTMLDetailsElement)ancestors.push(node);
    for(const details of ancestors)if(details.open)fireEvent.click(details.querySelector('summary')!);fireEvent.click(within(form).getByText('Save property',{selector:'button'}));
    expect(input).toHaveValue('1.234');expect(input).toHaveAttribute('aria-invalid','true');expect(ancestors.every(node=>node.open)).toBe(true);expect(controller.getState().savedPlan.revision).toBe(0);expect(controller.getState().savedPlan.rentals[0]!.taxHistory.california).toEqual(plan.rentals[0]!.taxHistory.california);
    expect(within(form).getByText(/^Federal AMT history/,{selector:'summary'})).toHaveTextContent('1 input error');fireEvent.click(within(form.querySelector('[data-form-feedback]')!).getByRole('button',{name:'Review Adjusted building basis'}));expect(input).toHaveFocus();
  });
  it('opens new loan sections for entry while distinguishing known-zero history from unknown',()=>{
    const {form}=propertyWorkspace();fireEvent.click(within(form).getByText('Add loan',{selector:'button'}));
    expect((within(form).getByText(/Loan — Purchase loan/,{selector:'summary'}).parentElement as HTMLDetailsElement).open).toBe(true);
  });
  it('keeps collapsed summary facts current during ordinary edits and marks unavailable loan inputs',()=>{
    const {form}=propertyWorkspace();for(const details of form.querySelectorAll('details'))if(!details.open)fireEvent.click(details.querySelector('summary')!);
    setField(form,'QBI qualification','unknown');expect(within(form).getByText(/^QBI history/,{selector:'summary'})).toHaveTextContent('1 unknown fact');
    setField(form,'Nominal APR (%)','1.234');expect(within(form).getByText(/^Loan —/,{selector:'summary'})).toHaveTextContent('Opening inputs unavailable');
    let federal=within(form).getByText(/^Federal history/,{selector:'summary'}).parentElement!;setField(federal,'History status','known-zero');
    federal=within(form).getByText(/^Federal history/,{selector:'summary'}).parentElement!;expect(federal.querySelector('summary')).toHaveTextContent('Confirmed zero');
    setField(federal,'Adjusted building basis','1.00');expect(federal.querySelector('summary')).toHaveTextContent('Entered amounts');
  });
});
