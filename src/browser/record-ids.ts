import type {FieldContext} from './fields';
import type {WorkspaceController} from './state';
export function idFor(controller:WorkspaceController,context:FieldContext,kind:string):string {
 const used=new Set<string>();function inspect(value:unknown):void {if(value&&typeof value==='object'){if('id' in value&&typeof value.id==='string')used.add(value.id);Object.values(value).forEach(inspect);}}
 inspect(controller.getState().savedPlan);inspect(controller.getState().drafts);inspect(controller.getState().allocationDraft);inspect(context.draft.value);
 let n=1;while(used.has(`${context.draft.recordId}-${kind}-${n}`))n++;
 return `${context.draft.recordId}-${kind}-${n}`;
}
