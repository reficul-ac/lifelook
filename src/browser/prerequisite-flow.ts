import type {Account,Salary} from '../engine/model/plan';
import type {EditPreviewOwner,EditTarget} from './edit-types';
import type {RawObject,SaveRecordResult,WorkspaceController} from './state';
export type PrerequisiteRequest=
  | {section:'accounts';defaults:RawObject;link(origin:RawObject,applied:Account):RawObject}
  | {section:'salaries';defaults:RawObject;link(origin:RawObject,applied:Salary):RawObject};
export function createPrerequisiteFlow(controller:WorkspaceController,ownership:{owner:EditPreviewOwner;isCurrent():boolean},navigate:(target:EditTarget)=>void):{begin(origin:EditTarget,request:PrerequisiteRequest):void;applied(target:EditTarget,result:SaveRecordResult):void;cancel():void;dispose():void} {
  type Detour={origin:EditTarget;target:Readonly<{kind:'record';section:'accounts'|'salaries';recordId:string}>;request:PrerequisiteRequest};
  const stack:Detour[]=[],owner={...ownership.owner};let disposed=false,invalidated=false;
  const current=()=>!disposed&&!invalidated&&ownership.isCurrent()&&owner.scenarioId===ownership.owner.scenarioId&&owner.sessionGeneration===ownership.owner.sessionGeneration&&owner.activationGeneration===ownership.owner.activationGeneration&&owner.workspaceGeneration===ownership.owner.workspaceGeneration;
  const matches=(left:EditTarget,right:EditTarget)=>left.kind===right.kind&&(left.kind==='allocation'||right.kind==='record'&&left.section===right.section&&left.recordId===right.recordId);
  const unsubscribe=controller.subscribe(operation=>{if(operation?.kind==='restore'){invalidated=true;stack.length=0;}});
  return {
    begin(origin,request){
      if(!current())return;
      const recordId=controller.beginAdd(request.section),draft=controller.getDraft(request.section,recordId);
      controller.editDraft(recordId,{...draft,value:{...draft.value,...structuredClone(request.defaults),id:recordId}});
      const target={kind:'record',section:request.section,recordId} as const;stack.push({origin:{...origin},target,request});navigate(target);
    },
    applied(target,result){
      if(!current()||!result.accepted)return;const detour=stack.at(-1);if(!detour||!matches(target,detour.target))return;
      const plan=controller.getState().savedPlan;let link:(raw:RawObject)=>RawObject;
      if(detour.request.section==='accounts'){const applied=plan.accounts.find(row=>row.id===detour.target.recordId);if(!applied)return;const request=detour.request;link=raw=>request.link(raw,applied);}
      else {const applied=plan.salaries.find(row=>row.id===detour.target.recordId);if(!applied)return;const request=detour.request;link=raw=>request.link(raw,applied);}
      const origin=detour.origin;
      if(origin.kind==='allocation'){const draft=controller.getAllocationDraft();controller.editAllocationDraft({...draft,value:link(structuredClone(draft.value))});}
      else {const draft=controller.getDraft(origin.section,origin.recordId);controller.editDraft(origin.recordId,{...draft,value:link(structuredClone(draft.value))});}
      stack.pop();navigate(origin);
    },
    cancel(){
      if(!current())return;const detour=stack.pop();if(!detour)return;
      if(!controller.getState().savedPlan[detour.target.section].some(record=>record.id===detour.target.recordId))controller.discardDraft(detour.target.recordId);
      navigate(detour.origin);
    },
    dispose(){if(disposed)return;disposed=true;stack.length=0;unsubscribe();},
  };
}
