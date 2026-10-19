import type {FormRenderOptions} from '../record-form';
import {idFor} from '../record-ids';
import {renderAduProjectFields} from './adu-project';
import {addAduProjectDraft,removeAduProjectDraft,type PropertyDraftBundle} from '../adu-project-draft';
import {isFuturePropertyPurchase,updatePropertyPurchaseDraft} from '../purchase-property-setup';
import type {IssueViewContext} from '../issue-presentation';
import {syncFormFeedback,setFormTaskIssues,registerFocusedForm} from '../form-feedback';
import {button,element,refreshFields,type FieldContext} from '../fields';
import {prepareEdit,type RawObject,type WorkspaceController} from '../state';
import {fieldMemory} from '../record-ui-state';
import {renderPropertyBasics} from './property-basics';
import {renderPropertyFinancing} from './property-financing';
import {renderPropertyRentals} from './property-rentals';
import {renderPropertyCosts} from './property-costs';
import {renderPropertyHistory} from './property-history';
import {at,details,disclosureStates,disclosureRoots,captureDisclosures} from './property-fields-shared';

function propertyFields(host:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const property=at(context,['property']) as RawObject,future=isFuturePropertyPurchase(property,controller.getState().savedPlan.startYear),memory=fieldMemory(context);
 const projectActions=(root:HTMLElement)=>{
  if(property.aduProject)root.append(button('Remove ADU project',()=>{if(context.ui&&!root.isConnected)return;memory.step='property';context.onChange([],removeAduProjectDraft(context.draft.value as unknown as PropertyDraftBundle));context.refresh();}));
  else if(property.role==='primary'&&!future)root.append(button('Build an ADU',()=>{if(context.ui&&!root.isConnected)return;memory.step='adu';context.onChange([],addAduProjectDraft(context.draft.value as unknown as PropertyDraftBundle,controller.getState().savedPlan.startYear,kind=>idFor(controller,context,kind)));context.refresh();}));
 };
 if(!context.memory){
  const advanced=property.aduProject?renderAduProjectFields(host,controller,context):undefined,main=advanced?details(host,'Existing home details',{key:`${context.draft.recordId}:home`}):host;
  renderPropertyBasics(main,controller,context);renderPropertyFinancing(main,controller,context);projectActions(main);const related=advanced??main;renderPropertyRentals(related,controller,context);renderPropertyHistory(related,controller,context);renderPropertyCosts(related,controller,context);return;
 }
 const steps=[['property','Property'],['financing','Financing'],['rent-costs','Rent & costs'],...(property.aduProject?[['adu','ADU setup']]:[])];if(!steps.some(([key])=>key===memory.step))memory.step=property.aduProject?'adu':'property';
 const nav=element('nav');nav.setAttribute('aria-label','Property groups');host.append(nav);
 const panels:HTMLElement[]=[],stepActions=element('div');
 const select=(step:string)=>{memory.step=step;for(const panel of panels)panel.hidden=panel.dataset.editorStep!==step;for(const action of nav.querySelectorAll<HTMLButtonElement>('[data-select-editor-step]'))action.setAttribute('aria-pressed',String(action.dataset.selectEditorStep===step));renderStepActions();};
 for(const [key,title] of steps){const action=button(title!,()=>select(key!));action.dataset.selectEditorStep=key;action.setAttribute('aria-pressed',String(memory.step===key));nav.append(action);}
 for(const [key,title] of steps){const panel=element('section');panel.dataset.editorStep=key;panel.hidden=memory.step!==key;panel.append(element('h3',title));host.append(panel);panels.push(panel);
  if(key==='property'){renderPropertyBasics(panel,controller,context);projectActions(panel);}
  else if(key==='financing')renderPropertyFinancing(panel,controller,context);
  else if(key==='rent-costs'){renderPropertyRentals(panel,controller,context);renderPropertyHistory(panel,controller,context);renderPropertyCosts(panel,controller,context);}
  else renderAduProjectFields(panel,controller,context);
 }
 host.append(stepActions);
 function renderStepActions():void {stepActions.replaceChildren();
 const index=steps.findIndex(([key])=>key===memory.step),next=steps[index+1];
 if(index>0)stepActions.append(button(`Back to ${steps[index-1]![1]}`,()=>select(steps[index-1]![0]!)));
 if(next)stepActions.append(button(`Continue to ${next[1]}`,()=>{
  const prepared=prepareEdit(controller,{kind:'record',section:'properties',recordId:context.draft.recordId});
  if(prepared.status==='invalid'&&!controller.getState().savedPlan.properties.some(row=>row.id===context.draft.recordId)){
   const issues=prepared.issues.filter(issue=>memory.step==='property'?!/loans|rentals|expenses|aduProject|purchaseFunding/.test(issue.field??''):memory.step==='financing'?/loans|purchaseFunding/.test(issue.field??''):true);
   if(issues.length){memory.attempted=true;const form=host.closest<HTMLElement>('form');if(form)setFormTaskIssues(form,issues,context.ui?.editorView);if(context.ui)syncFormFeedback(host,controller,context.ui);return;}
  }
  select(next[0]!);
 }));
 }
 renderStepActions();
}
/** Related property, loan, rental and expense rows remain one revisioned draft. */
export function renderPropertiesForm(root:HTMLElement,controller:WorkspaceController,ui?:IssueViewContext,options?:FormRenderOptions):void {
  if(ui?.editorView)disclosureStates.set(root,ui.editorView.propertyDisclosures);
  captureDisclosures(root);disclosureRoots.set(root,root);ui?.disclosures.closeWithin(root,false);root.replaceChildren();if(!options)root.append(element('h2','Properties'),element('p','Add homes you own or plan a future purchase. Select a down-payment funding source for purchases during the forecast. Existing primary homes can also plan an ADU build.'));
  const state=controller.getState(),ids=[...new Set([...state.savedPlan.properties.map(p=>p.id),...Object.values(state.drafts).filter(d=>d.section==='properties').map(d=>d.recordId)])];
  for(const id of options?ids.filter(id=>id===options.recordId):ids){
    const card=element('form');card.dataset.recordId=id;card.dataset.editableSection='properties';const body=element('div');disclosureRoots.set(body,root);card.append(element('h3',String(controller.getDraft('properties',id).value.property&& (controller.getDraft('properties',id).value.property as RawObject).name||'Property')),body);
    if(options){card.dataset.focusedForm='';registerFocusedForm(card,options.memory);card.addEventListener('focusout',event=>{const field=(event.target as HTMLElement).dataset.field;if(field){options.memory.touched.add(field);if(ui)syncFormFeedback(root,controller,ui);}});}
    const context:FieldContext={...(ui?{ui}:{}),...(options?{memory:options.memory,...(options.requestPrerequisite?{requestPrerequisite:options.requestPrerequisite}:{})}:{}),get draft(){return controller.getDraft('properties',id);},get issues(){return controller.getState().issues;},onChange(path,value){if(ui&&!root.isConnected)return;setFormTaskIssues(card,[],ui?.editorView);const draft=controller.getDraft('properties',id);controller.editDraft(id,{...draft,value:updatePropertyPurchaseDraft(draft.value,path,value,controller.getState().savedPlan.startYear,()=>idFor(controller,context,'rental'),!controller.getState().savedPlan.properties.some(property=>property.id===id))});},refresh(){captureDisclosures(body);ui?.disclosures.closeWithin(body,false);refreshFields(body,()=>propertyFields(body,controller,context));if(ui)syncFormFeedback(root,controller,ui);}};
    context.refresh();if(options){card.addEventListener('submit',event=>{event.preventDefault();options.memory.attempted=true;options.onSubmit();});root.append(card);continue;}const save=element('button','Save property');save.type='submit';card.append(save,button('Remove property',()=>controller.removeRecord('properties',id)));card.addEventListener('submit',event=>{event.preventDefault();controller.saveProperty(id);});
    card.append(element('small','Discards this draft and reloads applied inputs.'),button('Discard edits',()=>{setFormTaskIssues(card,[],ui?.editorView);controller.discardDraft(id);renderPropertiesForm(root,controller,ui);}));
    root.append(card);
  }
  if(ui)syncFormFeedback(root,controller,ui);
  if(!options)root.append(button('Add property',()=>controller.beginAdd('properties')));
}
