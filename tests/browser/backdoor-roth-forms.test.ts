import {openRecord} from '../helpers/workspace-ui';
import {memoryWorkspaceStorage} from '../helpers/scenarios';
import {mustValidate} from '../helpers/plans';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {mountWorkspace,setField} from '../helpers/dom';
import {makeAllocationPlan} from '../helpers/allocations';

let frames:Map<number,FrameRequestCallback>,sequence:number;
beforeEach(()=>{frames=new Map();sequence=0;vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++sequence,cb);return sequence;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));vi.stubGlobal('Worker',undefined);});
afterEach(()=>vi.unstubAllGlobals());
const flush=()=>{const queued=[...frames.values()];frames.clear();queued.forEach(cb=>cb(0));};
function setup(withTraditional=true){
  const base=makeAllocationPlan();
  const plan=makeAllocationPlan({horizonYears:2,salaries:[{...base.salaries[0]!,annualGrossCents:25200000}],accounts:[...base.accounts.filter(a=>withTraditional||a.type!=='traditional-ira'),{...base.accounts[1]!,id:'other-ira',name:'Other owner IRA',ownerId:'owner-b'},{...base.accounts[1]!,id:'roth',name:'Roth IRA',type:'roth-ira'}]});
  const store=memoryWorkspaceStorage(),result=mountWorkspace(plan,store.port);openRecord(result.root,{kind:'allocation'});
  const editor=within(result.root).getByRole('form',{name:'Cash flow allocation'});
  fireEvent.click(within(editor).getByRole('button',{name:'Add allocation'}));
  const row=within(editor).getByRole('group',{name:'Allocation 1'});
  setField(row,'Allocation destination','account:roth');
  return {...result,store,editor,row};
}
describe('backdoor Roth allocation controls',()=>{
  it('requires two explicit applies for a source IRA and allocation',()=>{
    const {controller,root,row,store}=setup(false),openingCount=controller.getState().savedPlan.accounts.length,originalPolicy=controller.getState().savedPlan.cashFlowAllocation;
    fireEvent.click(within(row).getByLabelText('Use backdoor Roth'));
    fireEvent.click(within(row).getByRole('button',{name:'Add source IRA'}));
    expect(controller.getState().savedPlan.accounts).toHaveLength(openingCount);expect(store.writes()).toBe(0);
    fireEvent.click(within(root).getByRole('button',{name:'Cancel and return'}));expect(controller.getState().savedPlan.accounts).toHaveLength(openingCount);
    fireEvent.click(within(root).getByRole('button',{name:'Add source IRA'}));apply(root,'Apply account');
    const source=controller.getState().savedPlan.accounts.find(a=>a.ownerId==='owner-a'&&a.type==='traditional-ira')!;
    expect(source).toMatchObject({openingBalanceCents:0,openingIraBasis:{known:true,value:0}});expect(controller.getState().savedPlan.revision).toBe(1);expect(store.writes()).toBe(1);
    expect(controller.getAllocationDraft().value.entries).toMatchObject([{destination:{backdoorRoth:{traditionalIraAccountId:source.id,cleanIraHistory:{known:false}}}}]);
    expect(controller.getState().savedPlan.cashFlowAllocation).toEqual(originalPolicy);expect(within(root).getByLabelText('Confirm clean IRA history')).not.toBeChecked();
    fireEvent.click(within(root).getByLabelText('Confirm clean IRA history'));apply(root,'Apply allocation');expect(controller.getState().savedPlan.revision).toBe(2);expect(store.writes()).toBe(2);
  });
  it('links only same-owner traditional IRAs and keeps the recurring route when changing preview year',()=>{
    const {controller,editor,row,root}=setup();
    fireEvent.click(within(row).getByLabelText('Use backdoor Roth'));
    const source=within(row).getByLabelText('Traditional IRA for conversion');
    expect(within(source).getByRole('option',{name:'IRA'})).toBeDefined();
    expect(within(source).queryByRole('option',{name:'Other owner IRA'})).toBeNull();
    setField(row,'Traditional IRA for conversion','ira');
    fireEvent.click(within(row).getByLabelText('Confirm clean IRA history'));
    fireEvent.click(within(row).getByLabelText('Max out for the year'));
    flush();
    const route={traditionalIraAccountId:'ira',cleanIraHistory:{known:true,value:true}};
    expect(controller.getAllocationDraft().value.entries).toMatchObject([{destination:{accountId:'roth',backdoorRoth:route},amount:{kind:'max-annual'}}]);
    preview(root);expect(row).toHaveTextContent('Backdoor Roth');
    setField(editor,'Allocation year','2027');
    apply(root,'Apply allocation');
    expect(controller.getState().savedPlan.cashFlowAllocation?.entries[0]?.destination).toEqual({kind:'account',accountId:'roth',backdoorRoth:route});
    for(const year of controller.getState().projection.years){
      const roth=year.accounts.find(a=>a.accountId==='roth')!;
      expect(roth.closingCents).toEqual({status:'available',value:(year.year-2025)*750000});
    }
  });
  it('preserves raw route edits for excess and removes them when switching to a non-Roth destination',()=>{
    const {controller,editor,row,root}=setup();
    setField(editor,'Excess allocation account','account:roth');
    const toggles=within(editor).getAllByLabelText('Use backdoor Roth');
    fireEvent.click(toggles[1]!);
    const sources=within(editor).getAllByLabelText('Traditional IRA for conversion');
    fireEvent.change(sources[0]!,{target:{value:'ira'}});
    fireEvent.click(within(editor).getByLabelText('Confirm clean IRA history'));
    expect((controller.getAllocationDraft().value.overflow as any).destination.backdoorRoth).toEqual({traditionalIraAccountId:'ira',cleanIraHistory:{known:true,value:true}});
    setField(editor,'Excess allocation account','account:brokerage');
    expect((controller.getAllocationDraft().value.overflow as any).destination).toEqual({kind:'account',accountId:'brokerage'});
    expect(within(editor).queryByLabelText('Traditional IRA for conversion')).toBeNull();
    setField(row,'Allocation destination','account:brokerage');
    expect(within(editor).queryByLabelText('Use backdoor Roth')).toBeNull();
  });
  it('keeps backdoor edits on their stable entry after a reordered restore',()=>{
    const {controller,editor,row,manager,root}=setup();
    fireEvent.click(within(row).getByLabelText('Use backdoor Roth'));
    fireEvent.click(within(row).getByLabelText('Confirm clean IRA history'));
    fireEvent.click(within(editor).getByRole('button',{name:'Add allocation'}));
    apply(root,'Apply allocation');
    const saved=controller.getState().savedPlan;
    expect(saved.cashFlowAllocation).toBeDefined();
    expect(manager.replaceScenario(manager.captureTarget(manager.getState().document.activeScenarioId)!,mustValidate({...saved,cashFlowAllocation:{...saved.cashFlowAllocation!,entries:[...saved.cashFlowAllocation!.entries].reverse()}})).accepted).toBe(true);const fresh=manager.getActiveSession().controller;
    openRecord(root,{kind:'allocation'});const moved=within(root).getByRole('group',{name:'Allocation 2'});
    fireEvent.click(within(moved).getByLabelText('Confirm clean IRA history'));
    expect(fresh.getAllocationDraft().value.entries).toMatchObject([{destination:{kind:'cash'}},{destination:{accountId:'roth',backdoorRoth:{cleanIraHistory:{known:true,value:false}}}}]);
    expect((fresh.getAllocationDraft().value.entries as any[])[0].destination.backdoorRoth).toBeUndefined();
  });
  it('shows the cash deposit and Roth conversion as separate account movements',()=>{
    const {controller,root,editor,row}=setup();
    fireEvent.click(within(row).getByLabelText('Use backdoor Roth'));
    fireEvent.click(within(row).getByLabelText('Confirm clean IRA history'));
    fireEvent.click(within(row).getByLabelText('Max out for the year'));
    apply(root,'Apply allocation');
    expect(controller.getState().savedPlan.revision).toBe(1);
    const closing=within(root).getByTestId('annual-2026-account-roth-closing');
    fireEvent.click(closing.closest('details')!.querySelector('summary')!);
    const table=closing.closest('table')!;
    expect(within(table).getByRole('columnheader',{name:'Roth conversion in'})).toBeDefined();
    expect(within(table).getByRole('columnheader',{name:'Roth conversion out'})).toBeDefined();
    const roth=within(table).getByRole('row',{name:/^Roth IRA /}) as HTMLTableRowElement;
    const traditional=within(table).getByRole('row',{name:/^IRA /}) as HTMLTableRowElement;
    expect(roth.cells[2]).toHaveTextContent('$0.00');
    expect(roth.cells[4]).toHaveTextContent('$7,500.00');
    expect(roth.cells[6]).toHaveTextContent('$7,500.00');
    expect(traditional.cells[2]).toHaveTextContent('$7,500.00');
    expect(traditional.cells[5]).toHaveTextContent('$7,500.00');
    expect(traditional.cells[6]).toHaveTextContent('$0.00');
  });
});

function preview(root:HTMLElement){root.querySelector<HTMLElement>('[data-active-editor] form')!.dispatchEvent(new CustomEvent('financial-input-commit',{bubbles:true}));flush();}
function apply(root:HTMLElement,label:string){const active=root.querySelector<HTMLElement>('[data-active-editor]')!;preview(root);fireEvent.click(within(active).getByRole('button',{name:new RegExp('^'+label+'$')}));}

it('restores an unfinished allocation mode without including inactive values',()=>{
 const {controller,row}=setup();setField(row,'Allocation percentage (%)','25.67');fireEvent.click(within(row).getByLabelText('Use backdoor Roth'));fireEvent.click(within(row).getByLabelText('Confirm clean IRA history'));fireEvent.click(within(row).getByLabelText('Max out for the year'));fireEvent.click(within(row).getByLabelText('Max out for the year'));expect(within(row).getByLabelText('Allocation percentage (%)')).toHaveValue('25.67');setField(row,'Allocation destination','account:brokerage');expect(controller.getAllocationDraft().value.entries).toMatchObject([{destination:{kind:'account',accountId:'brokerage'}}]);expect((controller.getAllocationDraft().value.entries as any[])[0].destination.backdoorRoth).toBeUndefined();setField(row,'Allocation destination','account:roth');expect(controller.getAllocationDraft().value.entries).toMatchObject([{destination:{accountId:'roth',backdoorRoth:{traditionalIraAccountId:'ira',cleanIraHistory:{known:true,value:true}}}}]);
});
