import {calculateProjection,type PlanDocument} from '../../src/engine';
import {createWorkspace,prepareEdit,completePreparedEdit,type WorkspaceController} from '../../src/browser/state';
import type {CalculatedEdit,EditTarget} from '../../src/browser/edit-types';
import {setAt,type FieldPath} from '../../src/browser/fields';
import {makeAllocationPlan} from './allocations';
import {memoryWorkspaceStorage} from './scenarios';
export function createEditHarness(plan:PlanDocument=makeAllocationPlan()) {const store=memoryWorkspaceStorage();return {controller:createWorkspace(plan,store.port),store};}
export function setDraftField(controller:WorkspaceController,target:EditTarget,path:FieldPath,value:unknown):void {
  if(target.kind==='allocation'){const draft=controller.getAllocationDraft();controller.editAllocationDraft({...draft,value:setAt(draft.value,path,value)});}
  else {const draft=controller.getDraft(target.section,target.recordId);controller.editDraft(target.recordId,{...draft,value:setAt(draft.value,path,value)});}
}
export function calculateEdit(controller:WorkspaceController,target:EditTarget):CalculatedEdit {
  const prepared=prepareEdit(controller,target);if(prepared.status!=='ready')throw Error(JSON.stringify(prepared));
  const receipt=completePreparedEdit(controller,prepared,calculateProjection(prepared.plan,prepared.ruleSet));if(!receipt)throw Error('Prepared edit became stale.');return receipt;
}
