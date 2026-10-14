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
