import type {Issue} from '../engine';
import {findRecordPath,normalizeFieldPath,type IssueViewContext} from './issue-presentation';
import {element,valueAt,type FieldPath} from './fields';
import type {RecordDraft,WorkspaceController,EditableSection} from './state';
export interface ResolvedFormIssue {readonly issue:Issue;readonly path?:FieldPath;readonly scope:'field'|'group'|'record'}
const pathOf=(path:string):FieldPath=>normalizeFieldPath(path).split('.').map(part=>/^\d+$/.test(part)?Number(part):part);
export function resolveFormIssues(draft:RecordDraft,planId:string,issues:readonly Issue[]):readonly ResolvedFormIssue[]{
  const results:ResolvedFormIssue[]=[];
  for(const issue of issues){
    const id=issue.recordId,prefix=id?findRecordPath(draft.value,id):undefined;
    if(id&&id!==draft.recordId&&prefix===undefined&&!(draft.section==='household'&&id===planId))continue;
    const field=normalizeFieldPath(issue.field??'');
    let canonical=field;
    if(prefix && !(id===draft.recordId&&/^(property|rentals|expenses)\./.test(field)) && !field.startsWith(`${prefix}.`))canonical=field?`${prefix}.${field}`:prefix;
    const path=canonical?pathOf(canonical):undefined;
    const value=path?valueAt(draft.value,path):undefined;
    // A missing optional leaf can still identify an editable field if its parent exists.
    const parent=path?.length?valueAt(draft.value,path.slice(0,-1)):undefined;
    if(path&&(value!==undefined||parent&&typeof parent==='object'&&Object.hasOwn(parent,path[path.length-1]!)))results.push({issue,path,scope:value&&typeof value==='object'?'group':'field'});
    else results.push({issue,scope:'record'});
  }return results;
}
function matching(form:HTMLElement,path:FieldPath):HTMLElement|undefined{
  const key=path.join('.'),fields=[...form.querySelectorAll<HTMLElement>('[data-field]')],groups=[...form.querySelectorAll<HTMLElement>('[data-field-group]')];
  return fields.find(node=>node.dataset.field===key)||groups.find(node=>node.dataset.fieldGroup===key)||fields.find(node=>node.dataset.field===`${key}.known`||node.dataset.field===`${key}.value`)||fields.find(node=>node.dataset.field?.startsWith(`${key}.`));
}
export function revealField(form:HTMLElement,path:FieldPath,focus=true):boolean{
  const target=matching(form,path);if(!target)return false;
  for(let ancestor:HTMLElement|null=target;ancestor&&form.contains(ancestor);ancestor=ancestor.parentElement)if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;
  if(focus){if(!target.matches('input,select,button,textarea'))target.tabIndex=-1;target.focus();target.scrollIntoView?.({block:'center'});}return true;
}
function conciseIssue(issue:Issue):string{
  if(issue.code==='invalid-input'&&issue.explanation.includes('ordinary decimal'))return 'Use up to 2 decimal places, without commas.';
  if(issue.code==='stale-record-draft')return 'Newer inputs changed this record. Discard edits, then reapply your changes.';
  return issue.explanation;
}
const lastIssues=new WeakMap<HTMLElement,readonly Issue[]>();
export function syncFormFeedback(root:HTMLElement,controller:WorkspaceController,context:IssueViewContext):void{
  const state=controller.getState();
  for(const form of root.querySelectorAll<HTMLElement>('form[data-record-id][data-editable-section]')){
    const id=form.dataset.recordId!,draft=controller.getDraft(form.dataset.editableSection as EditableSection,id);
    const resolved=resolveFormIssues(draft,state.savedPlan.id,state.issues),fresh=lastIssues.get(form)!==state.issues;
    const previous=lastIssues.get(form);lastIssues.set(form,state.issues);
    if(!resolved.length&&!previous?.length)continue;
    for(const control of form.querySelectorAll<HTMLElement>('[data-field]')){control.removeAttribute('aria-invalid');const hints=control.dataset.hintIds;if(hints)control.setAttribute('aria-describedby',hints);else control.removeAttribute('aria-describedby');}
    for(const error of form.querySelectorAll<HTMLElement>('[data-field-error]'))error.replaceChildren();
    let summary=form.querySelector<HTMLElement>('[data-form-feedback]');
    if(!summary){summary=element('div');summary.dataset.formFeedback='';form.append(summary);}
    context.disclosures.closeWithin(summary,false);summary.replaceChildren();if(!resolved.length)continue;
    summary.append(element('strong',resolved.some(item=>item.issue.severity==='error')?'Inputs not applied. Correct these errors and save again.':'Review these inputs.'));
    const list=element('ul');summary.append(list);
    for(const {issue,path} of resolved){
      const target=path?matching(form,path):undefined,control=target?.matches('input,select,textarea')?target:target?.querySelector<HTMLElement>('[data-field]');
      const label=control?.dataset.fieldLabel??target?.dataset.groupLabel??'This record',message=conciseIssue(issue);
      const row=element('li');row.className=`issue-${issue.severity}`;row.append(element('span',message+' '));
      if(path&&target){
        const review=element('button',`Review ${label}`);review.type='button';review.addEventListener('click',()=>{context.disclosures.closeWithin(root,false);revealField(form,path,true);});row.append(review);
        const error=control?.closest('[data-field-wrapper]')?.querySelector<HTMLElement>('[data-field-error]');
        if(error){error.append(element('span',message));if(issue.severity==='error'&&control){control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',[control.dataset.hintIds,error.id].filter(Boolean).join(' '));}}
        if(fresh&&issue.severity==='error')revealField(form,path,false);
      }
      row.append(context.disclosures.createTrigger({label:'Details',accessibleLabel:`Details: ${label} input`,title:`${label} · input error`,preview:message,renderDetails:node=>{node.append(element('p',issue.explanation),element('p',issue.resolution),element('code',[issue.code,issue.recordId,issue.field].filter(Boolean).join(' · ')));}}));list.append(row);
    }
  }
}
