import {describe,it,expect} from 'vitest';
import {prepareEdit} from '../../src/browser/state';
import {equalActiveEdit} from '../../src/browser/edit-candidate';
import {createEditHarness,setDraftField} from '../helpers/editing';
import {makeAllocationPlan} from '../helpers/allocations';
import {makeAduPlan} from '../helpers/adu';
const target={kind:'record',section:'salaries',recordId:'salary-a'} as const;
describe('financial edit preparation',()=>{
  it('prepares without applying and excludes unrelated drafts',()=>{
    const {controller,store}=createEditHarness(),before=controller.getState();
    setDraftField(controller,target,['annualGrossCents'],'125000.00');
    setDraftField(controller,{...target,recordId:'salary-b'},['annualGrossCents'],'broken');
    const prepared=prepareEdit(controller,target);expect(prepared).toMatchObject({status:'ready',plan:{revision:1,salaries:[{annualGrossCents:12500000},{annualGrossCents:10000000}]}});
    expect(controller.getState().savedPlan).toBe(before.savedPlan);expect(controller.getState().projection).toBe(before.projection);expect(store.writes()).toBe(0);
  });
  it('recognizes formatting-only and reversed edits without saving',()=>{
    const {controller,store}=createEditHarness();setDraftField(controller,target,['annualGrossCents'],'100000.0');expect(prepareEdit(controller,target)).toEqual({status:'unchanged'});
    setDraftField(controller,target,['annualGrossCents'],'125000.00');setDraftField(controller,target,['annualGrossCents'],'100000');expect(controller.saveRecord('salary-a').accepted).toBe(true);expect(controller.getState().savedPlan.revision).toBe(0);expect(store.writes()).toBe(0);
  });
  it('preserves equal-priority contribution order',()=>{
    const plan=makeAllocationPlan({contributions:['first','second'].map(id=>({id,accountId:'brokerage',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:100}}))});
    const {controller}=createEditHarness(plan),contribution={kind:'record',section:'contributions',recordId:'first'} as const;setDraftField(controller,contribution,['amount','monthlyCents'],'2.00');
    const prepared=prepareEdit(controller,contribution);if(prepared.status!=='ready')throw Error(JSON.stringify(prepared));expect(prepared.plan.contributions.map(row=>row.id)).toEqual(['first','second']);
    expect(controller.saveRecord('first').accepted).toBe(true);expect(controller.getState().savedPlan.contributions.map(row=>row.id)).toEqual(['first','second']);
  });
  it('rejects missing and changed identities and retains the raw invalid input',()=>{
    const {controller}=createEditHarness();expect(prepareEdit(controller,{...target,recordId:'missing'}).status).toBe('invalid');setDraftField(controller,target,['id'],'different');expect(prepareEdit(controller,target).status).toBe('invalid');expect(controller.getDraft('salaries','salary-a').value.id).toBe('different');
  });
  it('includes a genuinely new zero-valued record',()=>{const {controller}=createEditHarness(),id=controller.beginAdd('accounts');expect(prepareEdit(controller,{kind:'record',section:'accounts',recordId:id})).toMatchObject({status:'ready',plan:{accounts:expect.arrayContaining([expect.objectContaining({id,openingBalanceCents:0})])}});});
  it('compares object keys independently while preserving history, array order and optional absence',()=>{
    expect(equalActiveEdit({a:1,b:2},{b:2,a:1})).toBe(true);expect(equalActiveEdit({known:false},{known:true,value:0})).toBe(false);expect(equalActiveEdit([1,2],[2,1])).toBe(false);expect(equalActiveEdit({},{value:undefined})).toBe(false);
  });
  it('prepares the complete owning property bundle',()=>{const {controller}=createEditHarness(makeAduPlan()),property={kind:'record',section:'properties',recordId:'home'} as const;setDraftField(controller,property,['property','name'],'Preview home');setDraftField(controller,property,['rentals',0,'monthlyRentCents'],'1200.00');const prepared=prepareEdit(controller,property);expect(prepared).toMatchObject({status:'ready',plan:{properties:[{name:'Preview home'}],rentals:[{monthlyRentCents:120000}]}});});
  it('prepares allocation separately and ignores its inert opening defaults',()=>{const {controller}=createEditHarness(),allocation={kind:'allocation'} as const;expect(prepareEdit(controller,allocation)).toEqual({status:'unchanged'});setDraftField(controller,allocation,['overflow','destination'],{kind:'account',accountId:'brokerage'});setDraftField(controller,target,['annualGrossCents'],'broken');expect(prepareEdit(controller,allocation)).toMatchObject({status:'ready',plan:{cashFlowAllocation:{overflow:{destination:{accountId:'brokerage'}}},salaries:[{annualGrossCents:10000000},{annualGrossCents:10000000}]}});});
});
