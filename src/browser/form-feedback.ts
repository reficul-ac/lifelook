import {MAX_CENTS} from '../engine/money';
import {formatCents} from './views/issues';
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
    // Retain a missing leaf as a candidate; registered controls decide whether it is editable.
    const parent=path?.length?valueAt(draft.value,path.slice(0,-1)):undefined;
    if(path&&(value!==undefined||parent&&typeof parent==='object'&&Object.hasOwn(parent,path[path.length-1]!)))results.push({issue,path,scope:value&&typeof value==='object'?'group':'field'});
    else if(path&&parent&&typeof parent==='object')results.push({issue,path,scope:'record'});
    else results.push({issue,scope:'record'});
  }return results;
}
function matching(form:HTMLElement,path:FieldPath):HTMLElement|undefined{
  const key=path.join('.'),fields=[...form.querySelectorAll<HTMLElement>('[data-field]')],groups=[...form.querySelectorAll<HTMLElement>('[data-field-group]')];
  return fields.find(node=>node.dataset.field===key)||groups.find(node=>node.dataset.fieldGroup===key)||fields.find(node=>node.dataset.field===`${key}.known`||node.dataset.field===`${key}.value`);
}
export function revealField(form:HTMLElement,path:FieldPath,focus=true):boolean{
  const target=matching(form,path);if(!target)return false;
  for(let ancestor:HTMLElement|null=target;ancestor&&form.contains(ancestor);ancestor=ancestor.parentElement)if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;
  if(focus){if(!target.matches('input,select,button,textarea'))target.tabIndex=-1;target.focus();target.scrollIntoView?.({block:'center'});}return true;
}
export function formatFieldIssue(issue:Issue,draft:RecordDraft):string{
  const field=normalizeFieldPath(issue.field??''),leaf=field.split('.').pop()??'';
  const resolved=resolveFormIssues(draft,'',[issue])[0],raw=valueAt(draft.value,resolved?.path??pathOf(field));
  const money=leaf.endsWith('Cents')||/openingIraBasis|openingBalance\.value|openingPayment\.value|conversionBuildingFmv|qualifiedPrincipalCents|priorYearWagesCents|wagesCents|ubiaCents/.test(field);
  if(issue.code==='invalid-input'&&issue.explanation.includes('ordinary decimal')){
    if(typeof raw==='string'&&raw.trim()==='')return money?'Enter an amount; use 0 only if confirmed.':'Enter a percentage.';
    return 'Use up to 2 decimal places, without commas.';
  }
  if(issue.code==='invalid-input'&&issue.explanation.startsWith('Enter a whole number'))return 'Enter a whole number.';
  // Known validator domains, never bounds guessed from arbitrary explanation numbers.
  if(issue.code==='invalid-input'&&issue.explanation.startsWith('An integer from ')){
    if(leaf.endsWith('Bps')){const nonnegative=leaf==='aprBps'||draft.section==='contributions'&&leaf==='percentBps';return `Enter a percentage from ${nonnegative?'0%':'-99.99%'} to 1,000%.`;}
    if(money)return `Enter an amount from ${leaf==='openingCashCents'?formatCents(-MAX_CENTS):'$0.00'} to ${formatCents(MAX_CENTS)}.`;
    const domains:Record<string,string>={horizonYears:'Enter 1–40 years.',startYear:'Enter a year from 2026 to 9999.',raiseMonth:'Enter a month from 1 to 12.',raiseDay:'Enter a day from 1 to 31.',termMonths:'Enter 1–1,200 months.'};if(domains[leaf])return domains[leaf]!;
  }
  if(issue.code==='stale-record-draft')return 'Newer inputs changed this record. Discard edits, then reapply your changes.';
  if(issue.code==='calculation-failed')return 'Inputs could not be calculated. Correct the draft and save again.';
  return issue.explanation;
}

const summaries=new WeakMap<HTMLDetailsElement,()=>string>();
export function registerFormSummary(node:HTMLDetailsElement,read:()=>string):void {summaries.set(node,read);}
const taskIssues=new WeakMap<HTMLElement,readonly Issue[]>();
export function setFormTaskIssues(form:HTMLElement,issues:readonly Issue[]):void {taskIssues.set(form,issues);}
const lastIssues=new WeakMap<HTMLElement,readonly Issue[]>();
let groupErrorSequence=0;
export function syncFormFeedback(root:HTMLElement,controller:WorkspaceController,context:IssueViewContext):void{
  const state=controller.getState();
  for(const form of root.querySelectorAll<HTMLElement>('form[data-record-id][data-editable-section]')){
    const id=form.dataset.recordId!,draft=controller.getDraft(form.dataset.editableSection as EditableSection,id);
    const resolved=resolveFormIssues(draft,state.savedPlan.id,[...state.issues,...taskIssues.get(form)??[]]),fresh=lastIssues.get(form)!==state.issues;
    for(const disclosure of form.querySelectorAll<HTMLDetailsElement>('details[data-property-disclosure]')){const read=summaries.get(disclosure);if(read)disclosure.dataset.disclosureStatus=read();const heading=disclosure.querySelector('summary');if(heading)heading.textContent=disclosure.dataset.disclosureName+(disclosure.dataset.disclosureStatus?' · '+disclosure.dataset.disclosureStatus:'');}
    const previous=lastIssues.get(form);lastIssues.set(form,state.issues);
    if(!resolved.length&&!previous?.length&&!form.querySelector('[data-form-feedback]'))continue;
    for(const control of form.querySelectorAll<HTMLElement>('[data-field],[data-field-group]')){control.removeAttribute('aria-invalid');const hints=control.dataset.hintIds;if(hints)control.setAttribute('aria-describedby',hints);else control.removeAttribute('aria-describedby');}
    for(const error of form.querySelectorAll<HTMLElement>('[data-field-error]'))error.replaceChildren();
    let summary=form.querySelector<HTMLElement>('[data-form-feedback]');
    if(!summary){summary=element('div');summary.dataset.formFeedback='';form.append(summary);}
    context.disclosures.closeWithin(summary,false);summary.replaceChildren();for(const disclosure of form.querySelectorAll<HTMLDetailsElement>('details[data-property-disclosure]')){const heading=disclosure.querySelector('summary');if(heading)heading.textContent=disclosure.dataset.disclosureName+(disclosure.dataset.disclosureStatus?' · '+disclosure.dataset.disclosureStatus:'');}if(!resolved.length)continue;
    summary.append(element('strong',resolved.some(item=>item.issue.severity==='error')?'Inputs not applied. Correct these errors and save again.':'Review these inputs.'));
    const list=element('ul');summary.append(list);
    for(const {issue,path} of resolved){
      const target=path?matching(form,path):undefined,control=target?.matches('input,select,textarea')?target:undefined;
      const label=control?.dataset.fieldLabel??target?.dataset.groupLabel??'This record',message=formatFieldIssue(issue,draft);
      const row=element('li');row.className=`issue-${issue.severity}`;row.append(element('span',message+' '));
      if(path&&target){
        const review=element('button',`Review ${label}`);review.type='button';review.addEventListener('click',()=>{context.disclosures.closeWithin(root,false);revealField(form,path,true);});row.append(review);
        let error=control?.closest('[data-field-wrapper]')?.querySelector<HTMLElement>('[data-field-error]');
        if(!control&&target.hasAttribute('data-field-group')){
          error=[...target.children].find(node=>node.hasAttribute('data-group-error')) as HTMLElement|undefined;
          if(!error){error=element('small');error.dataset.groupError='';error.dataset.fieldError=path.join('.');error.id=`group-error-${++groupErrorSequence}`;error.className='field-error';target.append(error);}
        }
        if(error){error.append(element('span',message));if(issue.severity==='error'){const invalid=control??target;invalid.setAttribute('aria-invalid','true');invalid.setAttribute('aria-describedby',[invalid.dataset.hintIds,error.id].filter(Boolean).join(' '));}}
        if(fresh&&issue.severity==='error')revealField(form,path,false);
      }
      row.append(context.disclosures.createTrigger({label:'Details',accessibleLabel:`Details: ${label} input`,title:`${label} · input error`,preview:message,renderDetails:node=>{node.append(element('p',issue.explanation),element('p',issue.resolution),element('code',[issue.code,issue.recordId,issue.field].filter(Boolean).join(' · ')));}}));list.append(row);
    }
    for(const disclosure of form.querySelectorAll<HTMLDetailsElement>('details[data-property-disclosure]')){const prefix=disclosure.dataset.fieldGroup;const count=prefix?resolved.filter(item=>item.issue.severity==='error'&&(item.path?.join('.')===prefix||item.path?.join('.').startsWith(prefix+'.'))).length:0;const summary=disclosure.querySelector('summary');if(summary)summary.textContent=disclosure.dataset.disclosureName+(count?` · ${count} input error${count===1?'':'s'}`:disclosure.dataset.disclosureStatus?' · '+disclosure.dataset.disclosureStatus:'');}
  }
}
