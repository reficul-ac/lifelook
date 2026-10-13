import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {mountWorkspace,setField} from '../helpers/dom';
import {makeAllocationPlan,makeAllocationPolicy} from '../helpers/allocations';
import {mountCashFlowAllocationEditor} from '../../src/browser/forms/cash-flow-allocation';
import {resolveIssueTargets} from '../../src/browser/issue-presentation';
import {createDisclosureController} from '../../src/browser/disclosures';
import {calculateProjection} from '../../src/engine';
import {unmountApp} from '../../src/browser/main';
import {reviewTarget} from '../../src/browser/navigation';

let frames:Map<number,FrameRequestCallback>,sequence:number;
beforeEach(()=>{frames=new Map();sequence=0;vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++sequence,cb);return sequence;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));vi.stubGlobal('Worker',undefined);});
afterEach(()=>vi.unstubAllGlobals());
function flush(){const current=[...frames.values()];frames.clear();current.forEach(cb=>cb(0));}
function setup(plan=makeAllocationPlan({horizonYears:2})){const result=mountWorkspace(plan);fireEvent.click(within(result.root.querySelector('nav')!).getByRole('button',{name:'Investments'}));return {...result,editor:within(result.root).getByRole('form',{name:'Cash flow allocation'})};}
const row=(editor:HTMLElement,index=1)=>within(editor).getByRole('group',{name:`Allocation ${index}`});
const click=(root:HTMLElement,name:string)=>fireEvent.click(within(root).getByRole('button',{name}));

describe('native allocation policy editor',()=>{
 it('adds stable rows, applies a separate transaction, and discards independently',()=>{
  const {root,controller,editor}=setup();expect(editor).not.toHaveAttribute('data-editable-section');
  expect(within(editor).getByLabelText('Allocation year')).toHaveValue('2026');expect(within(editor).getByLabelText('Excess allocation account')).toHaveValue('cash');
  const unrelated=controller.beginAdd('expenses');click(editor,'Add allocation');const first=row(editor);setField(first,'Allocation destination','brokerage');setField(first,'Allocation priority','3');setField(first,'Allocation percentage (%)','12.34');
  const draft=controller.getAllocationDraft();expect(draft.value.entries).toMatchObject([{id:expect.any(String),priority:'3',amount:{kind:'percent',percentBps:'12.34'}}]);expect(within(root).getByTestId('draft-status')).toHaveTextContent('Allocation edits not applied');
  click(editor,'Apply allocation');expect(controller.getState().savedPlan.cashFlowAllocation?.entries[0]).toMatchObject({id:(draft.value.entries as any[])[0].id,priority:3,amount:{kind:'percent',percentBps:1234}});expect(controller.getState().drafts[unrelated]).toBeDefined();expect(within(root).getByTestId('save-announcement')).toHaveTextContent('Allocation applied');
  click(editor,'Add allocation');click(editor,'Discard allocation edits');expect(controller.getState().allocationDraft).toBeUndefined();expect(within(editor).getAllByRole('group',{name:/^Allocation \d+$/})).toHaveLength(1);
 });
 it('pairs exact text with a native range while preserving focused controls during rapid edits',()=>{
  const {controller,editor}=setup();click(editor,'Add allocation');const first=row(editor),text=within(first).getByLabelText('Allocation percentage (%)') as HTMLInputElement,slider=within(first).getByRole('slider',{name:'Allocation percentage slider'}) as HTMLInputElement;
  expect(slider).toHaveAttribute('min','0');expect(slider).toHaveAttribute('max','100');expect(slider).toHaveAttribute('step','0.01');text.focus();setField(first,'Allocation percentage (%)','12.34');text.setSelectionRange(2,2);flush();expect(slider.value).toBe('12.34');expect(text).toHaveFocus();expect(text.selectionStart).toBe(2);
  slider.focus();fireEvent.input(slider,{target:{value:'50.25'}});fireEvent.input(slider,{target:{value:'51.25'}});flush();expect(text.value).toBe('51.25');expect(slider).toHaveFocus();expect(within(first).getByRole('slider')).toBe(slider);expect(controller.getAllocationDraft().value.entries).toMatchObject([{amount:{percentBps:'51.25'}}]);
 });
 it('reopens a retained policy draft and calculates its full forecast without applying it',()=>{
  const {root,controller,editor}=setup();click(editor,'Add allocation');setField(row(editor),'Allocation percentage (%)','45.67');const retained=controller.getAllocationDraft();unmountApp(root);
  const disclosures=createDisclosureController(root),mounted=mountCashFlowAllocationEditor(editor.parentElement!,controller,{disclosures,readState:controller.getState,review:target=>reviewTarget(root,target)});flush();const reopened=within(root).getByRole('form',{name:'Cash flow allocation'});expect(row(reopened)).toHaveTextContent('Requested: 45.67%');expect(controller.getAllocationDraft()).toBe(retained);expect(controller.getState().savedPlan.revision).toBe(0);mounted.dispose();disclosures.dispose();
 });
 it('explains exact percentage limits in user units without discarding out-of-range raw text',()=>{
  const {editor}=setup();click(editor,'Add allocation');setField(row(editor),'Allocation percentage (%)','101.00');flush();const text=within(row(editor)).getByLabelText('Allocation percentage (%)');expect(text).toHaveValue('101.00');expect(text).toHaveAccessibleDescription('Enter a percentage from 0% to 100%.');
 });
 it('restricts maximum mode to retirement destinations and salary choices to the account owner',()=>{
  const {controller,editor}=setup();click(editor,'Add allocation');const first=row(editor);setField(first,'Allocation destination','brokerage');expect(within(first).queryByLabelText('Max out for the year')).toBeNull();setField(first,'Allocation destination','workplace');
  const sponsor=within(first).getByLabelText('Allocation sponsoring salary');expect(within(sponsor).getByRole('option',{name:'salary-a'})).toBeDefined();expect(within(sponsor).queryByRole('option',{name:'salary-b'})).toBeNull();setField(first,'Allocation sponsoring salary','salary-a');fireEvent.click(within(first).getByLabelText('Max out for the year'));
  expect(controller.getAllocationDraft().value.entries).toMatchObject([{destination:{accountId:'workplace',sponsoringSalaryId:'salary-a'},amount:{kind:'max-annual'}}]);expect(within(first).queryByRole('slider')).toBeNull();flush();expect(first).toHaveTextContent('Automatic annual maximum');
  setField(first,'Allocation destination','cash');expect(within(first).queryByLabelText('Max out for the year')).toBeNull();expect(controller.getAllocationDraft().value.entries).toMatchObject([{amount:{kind:'percent',percentBps:'0.00'}}]);
 });
 it('keeps annual maximum as a policy mode across selected years and Apply',()=>{
  const {controller,editor}=setup();click(editor,'Add allocation');setField(row(editor),'Allocation destination','ira');fireEvent.click(within(row(editor)).getByLabelText('Max out for the year'));flush();const draft=controller.getAllocationDraft();setField(editor,'Allocation year','2027');expect(controller.getAllocationDraft()).toBe(draft);expect(row(editor)).toHaveTextContent('Automatic annual maximum');expect(row(editor)).toHaveTextContent('$7,500.00');click(editor,'Apply allocation');expect(controller.getState().savedPlan.cashFlowAllocation?.entries[0]?.amount).toEqual({kind:'max-annual'});
 });
 it('retains invalid raw text and last valid preview with honest stale status and actionable errors',()=>{
  const {root,controller,editor}=setup();click(editor,'Add allocation');setField(row(editor),'Allocation percentage (%)','20.00');flush();expect(editor.querySelector('svg')).not.toBeNull();const applied=controller.getState().projection;
  const text=within(row(editor)).getByLabelText('Allocation percentage (%)');setField(row(editor),'Allocation percentage (%)','not a percent');flush();expect(text).toHaveValue('not a percent');expect(editor).toHaveTextContent('Stale preview');expect(editor).toHaveTextContent('Invalid allocation edits');expect(editor.querySelector('svg')).not.toBeNull();expect(text).toHaveAttribute('aria-invalid','true');
  click(editor,'Apply allocation');expect(controller.getState().projection).toBe(applied);click(editor,'Review Allocation percentage (%)');expect(text).toHaveFocus();expect(root.querySelector('[data-section="Investments"]')).toBeVisible();
 });
 it('keeps controls and draft scope across unrelated saves and clamps view-only year to the full forecast',()=>{
  const {root,controller,editor}=setup();click(editor,'Add allocation');setField(row(editor),'Allocation percentage (%)','10.00');flush();const draft=controller.getAllocationDraft(),slider=within(row(editor)).getByRole('slider');setField(editor,'Allocation year','2027');expect(editor).toHaveTextContent('Original cash flow · 2027');expect(controller.getAllocationDraft()).toBe(draft);
  const salary=controller.getDraft('salaries','salary-a');slider.focus();controller.editDraft(salary.recordId,{...salary,value:{...salary.value,annualGrossCents:'90000.00'}});controller.saveRecord(salary.recordId);flush();expect(within(row(editor)).getByRole('slider')).toBe(slider);expect(slider).toHaveFocus();expect(controller.getAllocationDraft()).toBe(draft);
  const household=controller.getDraft('household','household');controller.editDraft('household',{...household,value:{...household.value,startYear:'2028',horizonYears:'1'}});controller.saveRecord('household');flush();expect(within(editor).getByLabelText('Allocation year')).toHaveValue('2028');expect(controller.getAllocationDraft()).toBe(draft);expect(controller.getState().savedPlan.cashFlowAllocation?.entries).toHaveLength(0);expect(root.contains(editor)).toBe(true);
 });
 it('shows requested and capped actual shares, existing deposits and headroom before excess routing',()=>{
  const plan=makeAllocationPlan({cashFlowAllocation:makeAllocationPolicy({entries:[{id:'ira-percent',priority:1,destination:{kind:'account',accountId:'ira'},amount:{kind:'percent',percentBps:5000}}],overflow:{id:'excess',destination:{kind:'account',accountId:'brokerage'}}}),contributions:[{id:'legacy',accountId:'ira',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}]});
  const {editor}=setup(plan);expect(row(editor)).toHaveTextContent('Requested: 50.00%');expect(row(editor)).toHaveTextContent('Existing deposits included: $1,200.00');expect(row(editor)).toHaveTextContent('Actual funded: $7,500.00');expect(row(editor)).toHaveTextContent('Actual share:');expect(editor).toHaveTextContent('Remaining before excess:');expect(editor).not.toHaveTextContent('Remaining before excess: $0.00');
 });
 it('updates destination eligibility and sponsor choices from latest saved account types and ownership',()=>{
  const {controller,editor}=setup();click(editor,'Add allocation');const first=row(editor);setField(first,'Allocation destination','workplace');setField(first,'Allocation sponsoring salary','salary-a');
  const account=controller.getDraft('accounts','workplace');controller.editDraft(account.recordId,{...account,value:{...account.value,ownerId:'owner-b'}});controller.saveRecord(account.recordId);expect(within(within(first).getByLabelText('Allocation sponsoring salary')).queryByRole('option',{name:'salary-a'})).toBeNull();expect(within(first).getByLabelText('Allocation sponsoring salary')).toHaveValue('salary-a');
  const brokerage=controller.getDraft('accounts','brokerage');controller.editDraft(brokerage.recordId,{...brokerage,value:{...brokerage.value,type:'rsu',openingIraBasis:{known:false},rsu:{employerId:'employer-0',currentSharePriceCents:'100.00',grants:[]}}});expect(controller.saveRecord(brokerage.recordId).accepted).toBe(true);expect(within(within(first).getByLabelText('Allocation destination')).queryByRole('option',{name:'Stocks'})).toBeNull();
 });
 it('routes retained stale cash-shortfall details to the same current row after reordering',()=>{
  const base=makeAllocationPlan(),plan=makeAllocationPlan({salaries:[{...base.salaries[0]!,annualGrossCents:6000000}],accounts:[...base.accounts,{...base.accounts[0]!,id:'legacy-brokerage',name:'Legacy brokerage'}],contributions:[{id:'legacy',accountId:'legacy-brokerage',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:342000}}],cashFlowAllocation:makeAllocationPolicy({entries:[{id:'broker-row',priority:1,destination:{kind:'account',accountId:'brokerage'},amount:{kind:'percent',percentBps:5000}},{id:'cash-row',priority:2,destination:{kind:'cash'},amount:{kind:'percent',percentBps:5000}}]})});
  const {controller,editor}=setup(plan);expect(row(editor,2)).toHaveTextContent('Saving target: $25,684.00');expect(row(editor,2)).toHaveTextContent('Actual earmark: $0.00');expect(row(editor,2)).toHaveTextContent('Shortfall: $25,684.00');
  const draft=controller.getAllocationDraft(),values=draft.value.entries as any[];controller.editAllocationDraft({...draft,value:{...draft.value,entries:[values[1],{...values[0],amount:{kind:'percent',percentBps:'bad'}}]}});flush();expect(editor).toHaveTextContent('Stale preview');
  click(editor,'Cash / savings target funding details · 2026');const panel=within(document.body).getByRole('region',{name:'Cash / savings target funding · 2026'});fireEvent.click(within(panel).getByRole('button',{name:'Review Allocation · Cash / savings'}));expect(document.activeElement).toHaveAttribute('data-field-group','entries.0.amount');
 });
 it.each(['amount','amount.monthlyCents'])('resolves automatic excess %s notes to its current destination while retaining source identity',field=>{
  const plan=makeAllocationPlan({cashFlowAllocation:makeAllocationPolicy({overflow:{id:'producing-excess',destination:{kind:'account',accountId:'ira'}}})}),policy=plan.cashFlowAllocation!,issue={code:'ira-contribution-capped',recordId:policy.id,field:`cashFlowAllocation.overflow.${field}`,severity:'warning' as const,explanation:'A legal limit capped the automatic excess.',resolution:'Review the destination.'};
  const state={savedPlan:plan,drafts:{},allocationDraft:{recordId:policy.id,baseSnapshot:'synthetic',value:{...policy,overflow:{...policy.overflow,destination:{kind:'account',accountId:'brokerage'}}}}};expect(resolveIssueTargets(issue,state,plan)[0]).toMatchObject({recordId:policy.id,field:'overflow.destination'});
  const removed={...state,allocationDraft:{...state.allocationDraft,value:{...state.allocationDraft.value,overflow:{...state.allocationDraft.value.overflow,id:'different-excess'}}}};expect(resolveIssueTargets(issue,removed,plan)[0]).not.toHaveProperty('field');
 });
 it('focuses the excess destination group from an applied refusal note',()=>{
  const {editor}=setup(makeAllocationPlan({cashFlowAllocation:makeAllocationPolicy({overflow:{id:'limited-excess',destination:{kind:'account',accountId:'ira'}}})}));click(editor,'Cash retained details · 2026');const panel=within(document.body).getByRole('region',{name:'Cash retained · 2026'});fireEvent.click(within(panel).getByRole('button',{name:'Review Excess allocation · IRA'}));expect(document.activeElement).toHaveAttribute('data-field-group','overflow.destination');
 });
 it('keeps explicit cash earmark separate from total retained cash',()=>{
  const base=makeAllocationPlan(),{editor}=setup(makeAllocationPlan({salaries:[{...base.salaries[0]!,annualGrossCents:6000000}],cashFlowAllocation:makeAllocationPolicy({entries:[{id:'cash-row',priority:1,destination:{kind:'cash'},amount:{kind:'percent',percentBps:2000}}]})}));expect(row(editor)).toHaveTextContent('Saving target: $10,273.60');expect(row(editor)).toHaveTextContent('Actual earmark: $10,273.60');expect(row(editor)).toHaveTextContent('Actual share: 20.00%');expect(within(editor).getByRole('row',{name:/^Cash \/ savings/})).toHaveTextContent('$51,368.00');
 });
 it('replaces an applied preview when restore changes the policy even without an open draft',()=>{
  const plan=makeAllocationPlan({cashFlowAllocation:makeAllocationPolicy({entries:[{id:'cash-row',priority:1,destination:{kind:'cash'},amount:{kind:'percent',percentBps:2000}}]})});
  const {controller,editor}=setup(plan);expect(editor.querySelector('svg')).not.toBeNull();const {cashFlowAllocation:_,...restored}=makeAllocationPlan();controller.resetPlan(restored);expect(editor.querySelector('svg')).toBeNull();expect(editor).toHaveTextContent('No allocation policy applied.');
 });
 it('shows a rejected Apply immediately even when the queued invalid preview has not run',()=>{
  const {controller,editor}=setup();click(editor,'Add allocation');setField(row(editor),'Allocation percentage (%)','20.00');flush();setField(row(editor),'Allocation percentage (%)','bad');click(editor,'Apply allocation');
  expect(editor).toHaveTextContent('Invalid allocation edits');expect(editor).toHaveTextContent('Stale preview');expect(within(row(editor)).getByLabelText('Allocation percentage (%)')).toHaveValue('bad');expect(controller.getState().allocationDraft).toBeDefined();
 });
 it('removes by stable ID, supports nested review focus, and cancels queued previews on actual unmount',()=>{
  const {root,controller,editor}=setup();click(editor,'Add allocation');click(editor,'Add allocation');const second=(controller.getAllocationDraft().value.entries as any[])[1].id;click(row(editor),'Remove allocation');expect(controller.getAllocationDraft().value.entries).toMatchObject([{id:second}]);
  expect(reviewTarget(root,{section:'Investments',recordId:controller.getAllocationDraft().recordId,field:'entries.0.amount.percentBps',label:'Review allocation'})).toBe(true);expect(within(row(editor)).getByLabelText('Allocation percentage (%)')).toHaveFocus();expect(frames.size).toBeGreaterThan(0);unmountApp(root);expect(frames.size).toBe(0);controller.editAllocationDraft(controller.getAllocationDraft());expect(frames.size).toBe(0);
 });
});

class EditorWorker {
 static instances:EditorWorker[]=[];
 request:any;terminated=false;onmessage:((event:MessageEvent)=>void)|null=null;
 constructor(readonly url:URL,readonly options:WorkerOptions){EditorWorker.instances.push(this);}
 postMessage(request:unknown){this.request=request;}
 terminate(){this.terminated=true;}
 reply(){const {generation,plan,ruleSet,inputRevision}=this.request;this.onmessage?.({data:{generation,preview:{status:'calculated',projection:calculateProjection(plan,ruleSet),inputRevision}}} as MessageEvent);}
}
describe('editor worker lifecycle',()=>{
 it('rejects obsolete worker replies and terminates calculation on real app unmount',()=>{
  EditorWorker.instances=[];vi.stubGlobal('Worker',EditorWorker);const {root,editor}=setup();click(editor,'Add allocation');setField(row(editor),'Allocation percentage (%)','20.00');flush();const old=EditorWorker.instances[0]!;setField(row(editor),'Allocation percentage (%)','30.00');expect(old.terminated).toBe(true);flush();const current=EditorWorker.instances[1]!;old.reply();expect(row(editor)).not.toHaveTextContent('Requested: 20.00%');current.reply();expect(row(editor)).toHaveTextContent('Requested: 30.00%');setField(row(editor),'Allocation percentage (%)','40.00');flush();const pending=EditorWorker.instances[2]!;unmountApp(root);expect(pending.terminated).toBe(true);pending.reply();expect(row(editor)).toHaveTextContent('Requested: 30.00%');
 });
});
