import { describe,expect,it } from 'vitest';
import { createWorkspace,fromDraftValue } from '../../src/browser/state';
import { loadRuleSet } from '../../src/engine';
import { makePlan } from '../helpers/plans';
const storage={getItem:()=>null,setItem:()=>{}};
describe('record identity and independent draft transactions',()=>{
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
