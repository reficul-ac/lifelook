import {it,expect} from 'vitest';
import {createEditorSession,type EditorPublicationPort} from '../../src/browser/state';
import {loadRuleSet} from '../../src/engine';
import {makePlan} from '../helpers/plans';
it('stages a matching plan/report and clears drafts only after publication accepts',()=>{
  let reject=true,persisted=false,calls=0;const port:EditorPublicationPort={readPersistence:()=>({persisted,persistenceIssues:[]}),retry:()=>({accepted:true}),publish(plan,projection,commit){calls++;expect(projection.inputRevision).toBe(plan.revision);if(reject)return {accepted:false,issues:[{code:'rejected',severity:'error',explanation:'Retain it',resolution:'Retry'}]};commit();persisted=true;return {accepted:true};}};
  const editor=createEditorSession(makePlan(),port,loadRuleSet()),before=editor.getState();const draft=editor.getDraft('household','household');editor.editDraft('household',{...draft,value:{...draft.value,openingCashCents:'10.00'}});
  expect(editor.saveRecord('household').accepted).toBe(false);expect(editor.getState().savedPlan).toBe(before.savedPlan);expect(editor.getState().drafts.household).toBeDefined();
  reject=false;expect(editor.saveRecord('household')).toMatchObject({accepted:true,persisted:true});expect(editor.getState().savedPlan.openingCashCents).toBe(1000);expect(editor.getState().drafts.household).toBeUndefined();expect(calls).toBe(2);
  persisted=false;expect(editor.getState().persisted).toBe(false);expect(()=>editor.resetPlan(makePlan())).toThrow();expect(editor.getState().savedPlan.openingCashCents).toBe(1000);
});

it('publishes a completed preview only when the scenario publication port accepts',()=>{
 let reject=true;const port:EditorPublicationPort={readPersistence:()=>({persisted:false,persistenceIssues:[]}),retry:()=>({accepted:true}),publish(plan,projection,commit){expect(plan.revision).toBe(projection.inputRevision);if(reject)return {accepted:false,issues:[{code:'blocked',severity:'error',explanation:'Blocked',resolution:'Retry'}]};commit();return {accepted:true};}};
 const controller=createEditorSession(makeAllocationPlan(),port,loadRuleSet()),target={kind:'record',section:'salaries',recordId:'salary-a'} as const;setDraftField(controller,target,['annualGrossCents'],'125000.00');const receipt=calculateEdit(controller,target),before=controller.getState();expect(applyCalculatedEdit(controller,receipt).accepted).toBe(false);expect(controller.getState().savedPlan).toBe(before.savedPlan);expect(controller.getState().drafts['salary-a']).toBeDefined();reject=false;expect(applyCalculatedEdit(controller,receipt).accepted).toBe(true);expect(controller.getState().projection).toBe(receipt.projection);
});
import {applyCalculatedEdit} from '../../src/browser/state';
import {calculateEdit,setDraftField} from '../helpers/editing';
import {makeAllocationPlan} from '../helpers/allocations';
