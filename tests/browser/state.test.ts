import { describe,expect,it } from 'vitest';
import { createWorkspace,fromDraftValue,prepareEdit,type WorkspaceOperation } from '../../src/browser/state';
import { loadRuleSet } from '../../src/engine';
import { makePlan } from '../helpers/plans';
const storage={getItem:()=>null,setItem:()=>{}};
describe('record identity and independent draft transactions',()=>{
  it('prepares invalid inputs without publishing validation feedback',()=>{const controller=createWorkspace(makePlan(),storage),draft=controller.getDraft('household','household');controller.editDraft('household',{...draft,value:{...draft.value,openingCashCents:'-'}});const before=controller.getState();expect(prepareEdit(controller,{kind:'record',section:'household',recordId:'household'}).status).toBe('invalid');expect(controller.getState().issues).toBe(before.issues);expect(controller.getState().savedPlan).toBe(before.savedPlan);});
  it('retains ordinary fractional living areas without treating them as money or whole numbers',()=>{
    expect(fromDraftValue({primaryArea:'1500.5',aduArea:'500.25'},'home')).toEqual({value:{primaryArea:1500.5,aduArea:500.25},issues:[]});
    expect(fromDraftValue({primaryArea:'1e3'},'home').issues).toContainEqual(expect.objectContaining({field:'primaryArea'}));
  });
  it('does not reuse a nested saved loan ID for a new financial record',()=>{
    const plan=makePlan({properties:[{id:'home',name:'Home',role:'primary',purchaseDate:'2025-01-01',purchasePriceCents:0,downPaymentCents:0,openingValueCents:0,appreciationBps:0,appreciationOverrides:[],loans:[{id:'accounts-1',name:'Loan',originalPrincipalCents:0,aprBps:0,originationDate:'2025-01-01',acquisitionDate:'2025-01-01',termMonths:360,firstPaymentDate:'2025-01-31',openingBalance:{known:true,value:0},openingPayment:{known:true,value:0},collateralPropertyId:'home',proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:{known:true,value:true},qualifiedPrincipalCents:{known:true,value:0},historyComplete:{known:true,value:true}},proceedsAllocations:[{propertyId:'home',use:'personal',share:{numerator:1,denominator:1}}],financingAtRiskQualification:{known:true,value:true}}]}]});
    const controller=createWorkspace(plan,storage,loadRuleSet()),id=controller.beginAdd('accounts');expect(id).not.toBe('accounts-1');expect(controller.saveRecord(id).accepted).toBe(true);
  });
  it('retains the original saved record ID when a draft tries to change it',()=>{
    const controller=createWorkspace(makePlan({accounts:[{id:'account-a',name:'Account',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:10000,annualGrowthBps:0,openingIraBasis:{known:false}}]}),storage,loadRuleSet());
    const draft=controller.getDraft('accounts','account-a');controller.editDraft('account-a',{...draft,value:{...draft.value,id:'account-b'}});
    expect(controller.saveRecord('account-a').accepted).toBe(false);expect(controller.getState().savedPlan.accounts[0]?.id).toBe('account-a');expect(controller.getState().savedPlan.revision).toBe(0);
  });
  it('reads structurally valid record IDs that coincide with object prototype names',()=>{
    const controller=createWorkspace(makePlan({accounts:[{id:'constructor',name:'Constructor account',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:10000,annualGrowthBps:0,openingIraBasis:{known:false}}]}),storage,loadRuleSet());
    expect(controller.getDraft('accounts','constructor').value.name).toBe('Constructor account');
  });
  it('saves one record without saving an independent unfinished draft',()=>{
    const controller=createWorkspace(makePlan(),storage,loadRuleSet()),id=controller.beginAdd('salaries');
    const household=controller.getDraft('household','household');controller.editDraft('household',{...household,value:{...household.value,openingCashCents:'10.00'}});
    expect(controller.saveRecord('household').accepted).toBe(true);expect(controller.getState().savedPlan.salaries).toEqual([]);expect(controller.getState().drafts[id]).toBeDefined();expect(controller.getState().savedPlan.revision).toBe(1);
  });
});

describe('durable persistence and operation outcomes',()=>{
  it('retains failed storage through invalid saves, adds/discards, and clears it only after a successful write',()=>{
    let fail=true;const controller=createWorkspace(makePlan(),{getItem:()=>null,setItem:()=>{if(fail)throw new Error('quota');}},loadRuleSet());
    const edit=(value:string)=>{const draft=controller.getDraft('household','household');controller.editDraft('household',{...draft,value:{...draft.value,openingCashCents:value}});};
    edit('10.00');expect(controller.saveRecord('household').accepted).toBe(true);const failure=controller.getState().persistenceIssues;expect(failure).toContainEqual(expect.objectContaining({code:'storage-write-failed'}));
    edit('1.234');expect(controller.saveRecord('household').accepted).toBe(false);expect(controller.getState().persistenceIssues).toBe(failure);expect(controller.getState().persisted).toBe(false);
    const id=controller.beginAdd('accounts');controller.discardDraft(id);expect(controller.getState().persistenceIssues).toBe(failure);
    fail=false;edit('20.00');const result=controller.saveRecord('household');expect(result.persistenceIssues).toEqual([]);expect(result.issues).toEqual([]);expect(controller.getState().persisted).toBe(true);
  });
  it('emits one explicit outcome for every save/remove, while drafts emit no operation',()=>{
    const controller=createWorkspace(makePlan(),storage,loadRuleSet()),operations:(WorkspaceOperation|undefined)[]=[];controller.subscribe(operation=>operations.push(operation));
    const id=controller.beginAdd('accounts');expect(operations).toEqual([undefined]);operations.length=0;
    controller.saveRecord(id);expect(operations).toHaveLength(1);expect(operations[0]).toMatchObject({kind:'save',recordId:id,result:{accepted:true}});operations.length=0;
    controller.removeRecord('accounts',id);expect(operations).toHaveLength(1);expect(operations[0]).toMatchObject({kind:'remove',recordId:id});operations.length=0;
    controller.saveRecord('missing');expect(operations).toHaveLength(1);expect(operations[0]).toMatchObject({kind:'save',recordId:'missing',result:{accepted:false}});
  });
  it('keeps coverage out of the recovery channel and restores only explicit write failures',()=>{
    const plan=makePlan(),incomplete={...plan,household:{...plan.household,coverageAnswers:{...plan.household.coverageAnswers,additionalIncome:{known:false as const}}}};
    const controller=createWorkspace(incomplete,storage,loadRuleSet());controller.saveRecord('household');expect(controller.getState().persistenceIssues).toEqual([]);expect(controller.getState().issues).toEqual([]);expect(controller.getState().projection.coverage.completeHouseholdLiability).toBe(false);
    controller.resetPlan(incomplete,{persisted:false,persistenceIssues:[{code:'storage-write-failed',severity:'error',explanation:'Storage failed',resolution:'Export backup'}]});const id=controller.beginAdd('accounts');controller.discardDraft(id);expect(controller.getState().persistenceIssues).toHaveLength(1);
  });
});
