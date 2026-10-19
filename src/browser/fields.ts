import {mountNumericControl} from './ui/numeric-control';
import {mountDateControl} from './ui/date-control';
import {mountSwitchControl} from './ui/switch-control';
import {renderRecordForm, type FormRenderOptions} from './record-form';
import {fieldMemory,fieldModeKey,swapMode,type RecordEditorMemory} from './record-ui-state';
import type {PrerequisiteRequest} from './prerequisite-flow';
import type {IssueViewContext} from './issue-presentation';
import {syncFormFeedback} from './form-feedback';
import type {Issue} from '../engine';
import type { EditableSection,RawObject,RecordDraft,WorkspaceController } from './state';

export type FieldPath=readonly (string|number)[];
export interface FieldContext {readonly ui?:IssueViewContext;readonly memory?:RecordEditorMemory;requestPrerequisite?(request:PrerequisiteRequest):void;readonly draft:RecordDraft;readonly issues:readonly Issue[];onChange(path:FieldPath,value:unknown):void;refresh():void}
export interface FieldOptions {readonly slider?:{minUnits:number;maxUnits:number;stepUnits:number};readonly visibleLabel?:string;readonly help?:string;readonly kind?:'money'|'rate'|'integer'|'text'|'date'|'month'|'select'|'checkbox'|'switch';readonly options?:readonly (string|Readonly<{value:string;label:string}>)[];readonly hint?:string;readonly optional?:boolean;readonly refresh?:boolean}
export {parseMoneyInput,parseRateInput} from './input-parsers';
export function valueAt(value:unknown,path:FieldPath):unknown{return path.reduce<unknown>((current,key)=>current&&typeof current==='object'?(current as Record<string|number,unknown>)[key]:undefined,value);}
export function setAt(value:RawObject,path:FieldPath,entry:unknown):RawObject {
  if(!path.length)return entry as RawObject;
  const next=structuredClone(value);let node:any=next;
  path.forEach((key,i)=>{if(i===path.length-1){if(entry===undefined)delete node[key];else node[key]=entry;}else{node[key]??=typeof path[i+1]==='number'?[]:{};node=node[key];}});return next;
}
export function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string):HTMLElementTagNameMap[K]{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
export function button(label:string,action:()=>void):HTMLButtonElement{const node=element('button',label);node.type='button';node.addEventListener('click',action);return node;}
/** Structural field changes retain the keyboard position when that control still exists. */
export function refreshFields(root:HTMLElement,render:()=>void):void {
  const active=document.activeElement instanceof HTMLElement&&root.contains(document.activeElement)?document.activeElement:undefined;
  const field=active?.dataset.field;
  const selection=active instanceof HTMLInputElement&&active.type==='text'?[active.selectionStart,active.selectionEnd] as const:undefined;
  root.replaceChildren();render();
  if(!field)return;
  const replacement=[...root.querySelectorAll<HTMLElement>('[data-field]')].find(control=>control.dataset.field===field);
  replacement?.focus();
  if(selection&&replacement instanceof HTMLInputElement&&replacement.type==='text')replacement.setSelectionRange(selection[0],selection[1]);
}
export const taxCategoryOptions=[{value:'property-tax',label:'Property tax'},{value:'homeowners-insurance',label:'Homeowners insurance'},{value:'mortgage-insurance',label:'Mortgage insurance'},{value:'repair',label:'Repairs'},{value:'operating',label:'Operating costs'},{value:'capital',label:'Capital improvements'},{value:'personal',label:'Personal costs'}];
const shortLabel=(label:string):string=>label.replace(/^(?:Filer \d+ |Property expense |Property |Salary |Income |Expense |Debt |Account |Contribution )/,'');
let fieldSequence=0;
/** Retain native segments until focus leaves, then finish any pointer activation first. */
function nativeDateRefresh(input:HTMLInputElement,refresh:()=>void):()=>boolean {
  const doc=input.ownerDocument,view=doc.defaultView!;
  let tracking=false,pending=false,pointerDown=false,frame:number|undefined;
  const stop=()=>{
    tracking=false;pointerDown=false;
    if(frame!==undefined){view.cancelAnimationFrame(frame);frame=undefined;}
    doc.removeEventListener('pointerdown',pointerStart,true);
    doc.removeEventListener('pointerup',pointerEnd,true);
    doc.removeEventListener('pointercancel',pointerEnd,true);
    doc.removeEventListener('click',pointerEnd,true);
    doc.removeEventListener('focusout',focusOut,true);
    view.removeEventListener('blur',windowBlur);
  };
  const flush=(activated=false)=>{
    if(!tracking)return;
    if(!input.isConnected){pending=false;stop();return;}
    if(pointerDown)return;
    const active=doc.activeElement;
    if(active instanceof HTMLInputElement&&(active.type==='date'||active.type==='month'))return;
    // Tab must leave the next action available for Enter/Space activation.
    if(!activated&&active instanceof HTMLElement&&active.matches('button,summary,a[href],[role="button"]')&&input.closest('form')?.contains(active))return;
    const changed=pending;pending=false;stop();if(changed)refresh();
  };
  const pointerStart=()=>{pointerDown=true;};
  const pointerEnd=()=>{
    pointerDown=false;
    // Start a frame only after release/click/cancel, never during a held press.
    // Native click handlers and disclosure default actions finish before this frame.
    if(frame===undefined)frame=view.requestAnimationFrame(()=>{frame=undefined;flush(true);});
  };
  const focusOut=()=>queueMicrotask(flush);
  const windowBlur=()=>{pointerDown=false;queueMicrotask(flush);};
  const start=()=>{
    if(tracking)return;tracking=true;
    doc.addEventListener('pointerdown',pointerStart,true);
    doc.addEventListener('pointerup',pointerEnd,true);
    doc.addEventListener('pointercancel',pointerEnd,true);
    doc.addEventListener('click',pointerEnd,true);
    doc.addEventListener('focusout',focusOut,true);
    view.addEventListener('blur',windowBlur);
  };
  input.addEventListener('focus',start);
  input.addEventListener('blur',focusOut);
  return ()=>{
    if(!tracking&&doc.activeElement!==input)return false;
    start();pending=true;return true;
  };
}
export function renderField(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:FieldOptions={}):HTMLInputElement|HTMLSelectElement {
  if(options.kind==='money'&&!label.includes('$'))label+=' ($)';
  const wrapper=element('div');wrapper.className='field-wrapper';wrapper.dataset.fieldWrapper='';
  const kind=options.kind??'text',value=valueAt(context.draft.value,path),key=path.join('.');
  let control:HTMLInputElement|HTMLSelectElement;
  let deferDateRefresh:(()=>boolean)|undefined;
  const change=(raw:unknown)=>{
    context.onChange(path,options.optional&&raw===''?undefined:raw);
    if(!options.refresh||kind==='checkbox'||kind==='switch')return;
    if(!deferDateRefresh?.())context.refresh();
  };
  if(kind==='money'||kind==='rate') {
    control=mountNumericControl(wrapper,{label,field:key,kind,raw:value===undefined?'':String(value),...(options.slider?{slider:options.slider}:{}),onInput:change,onCommit:()=>{}}).input;
    const caption=wrapper.querySelector('label');if(caption)caption.textContent=options.visibleLabel??shortLabel(label);
  } else if(kind==='date'||kind==='month') {
    control=mountDateControl(wrapper,{label,field:key,kind,raw:value===undefined?'':String(value),onInput:change,onCommit:()=>{}}).input;
    const caption=wrapper.querySelector('label');if(caption)caption.textContent=options.visibleLabel??shortLabel(label);
    deferDateRefresh=nativeDateRefresh(control,()=>context.refresh());
  } else if(kind==='checkbox'||kind==='switch') {
    control=mountSwitchControl(wrapper,{label,field:key,checked:value===true,onChange:change}).input;
    const caption=wrapper.querySelector('label > span');if(caption)caption.textContent=options.visibleLabel??shortLabel(label);
    if(options.refresh)control.addEventListener('change',()=>context.refresh());
  } else {
    const caption=element('label',options.visibleLabel??shortLabel(label));wrapper.append(caption);
    control=kind==='select'?element('select'):element('input');control.id=`field-${++fieldSequence}`;caption.htmlFor=control.id;
    if(control instanceof HTMLSelectElement){for(const option of options.options??[]){const entry=element('option',typeof option==='string'?option:option.label);entry.value=typeof option==='string'?option:option.value;control.append(entry);}}
    else {control.type='text';if(kind==='integer')control.inputMode='numeric';if(['primaryArea','aduArea'].includes(String(path.at(-1))))control.inputMode='decimal';}
    control.value=value===undefined?'':String(value);
    control.addEventListener(kind==='select'?'change':'input',()=>change(control.value));
    if(kind==='select')control.addEventListener('change',()=>control.dispatchEvent(new CustomEvent('financial-input-commit',{bubbles:true})));
    wrapper.append(control);
  }
  control.dataset.fieldLabel=label;control.dataset.fieldKind=kind;control.name=key;control.dataset.field=key;control.setAttribute('aria-label',label);
  if(options.hint){const hint=element('small',options.hint);hint.id=`${control.id}-hint`;wrapper.append(hint);control.dataset.hintIds=hint.id;control.setAttribute('aria-describedby',hint.id);const range=wrapper.querySelector('input[type=range]');if(range)range.setAttribute('aria-describedby',[range.getAttribute('aria-describedby'),hint.id].filter(Boolean).join(' '));}
  if(options.help&&context.ui)wrapper.append(context.ui.disclosures.createTrigger({label:'ⓘ',accessibleLabel:`ⓘ About ${options.visibleLabel??shortLabel(label)}`,preview:options.help,title:label,renderDetails:node=>{node.textContent=options.help!;}}));
  const range=wrapper.querySelector<HTMLElement>('input[data-numeric-slider]');if(range)range.dataset.hintIds=range.getAttribute('aria-describedby')??'';
  const error=element('small');error.id=`${control.id}-error`;error.dataset.fieldError=key;error.className='field-error';wrapper.append(error);root.append(wrapper);return control;
}
export function renderBooleanHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:Pick<FieldOptions,'visibleLabel'|'hint'|'help'>={}):HTMLSelectElement {
  const history=valueAt(context.draft.value,path) as {known?:boolean;value?:boolean}|undefined;
  const choice:FieldContext={...context,get draft(){return {...context.draft,value:setAt(context.draft.value,path,history?.known?String(history.value):'unknown')};},onChange(_path,value){context.onChange(path,value==='unknown'?{known:false}:{known:true,value:value==='true'});}};
  return renderField(root,choice,path,label,{...options,kind:'select',options:[{value:'unknown',label:'Unknown'},{value:'true',label:'Yes'},{value:'false',label:'No'}]}) as HTMLSelectElement;
}
export function renderHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:FieldOptions={}):void {
  if(options.kind==='checkbox'||options.kind==='select'||options.kind==='switch'){renderBooleanHistory(root,context,path,label,options);return;}
  const group=element('fieldset');group.dataset.fieldGroup=path.join('.');group.dataset.groupLabel=label;group.append(element('legend',options.visibleLabel??shortLabel(label)));
  const history=valueAt(context.draft.value,path) as {known?:boolean;value?:unknown}|undefined;
  const statusContext:FieldContext={...context,get draft(){return {...context.draft,value:setAt(context.draft.value,[...path,'known'],history?.known?'known':'unknown')};},onChange(_path,value){const current=valueAt(context.draft.value,path) as RawObject|undefined;context.onChange(path,swapMode(fieldMemory(context),`history:${fieldModeKey(context,path)}`,current?.known?'known':'unknown',String(value),current??{known:false},value==='unknown'?{known:false}:{known:true,value:''}));}};
  renderField(group,statusContext,[...path,'known'],`${label} history`,{kind:'select',visibleLabel:'history',...(options.hint?{hint:options.hint}:{}),options:[{value:'unknown',label:'Unknown'},{value:'known',label:'Enter value'}],refresh:true});
  if(history?.known){const {hint,...entryOptions}=options;renderField(group,context,[...path,'value'],`${label} value`,{...entryOptions,visibleLabel:'value'});}

  root.append(group);
}
export function renderRows(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,makeRow:()=>RawObject,renderRow:(root:HTMLElement,path:FieldPath,index:number)=>void):void {
  const group=element('fieldset');group.dataset.fieldGroup=path.join('.');group.dataset.groupLabel=label;group.append(element('legend',label));const rows=valueAt(context.draft.value,path) as readonly RawObject[]|undefined;
  (rows??[]).forEach((_,index)=>{const row=element('fieldset');row.append(element('legend',`${label} ${index+1}`));renderRow(row,[...path,index],index);row.append(button(`Remove ${label} ${index+1}`,()=>{context.onChange(path,(valueAt(context.draft.value,path) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));group.append(row);});
  group.append(button(`Add ${label}`,()=>{context.onChange(path,[...((valueAt(context.draft.value,path) as readonly RawObject[])??[]),makeRow()]);context.refresh();}));root.append(group);
}
export function renderRecordSection(root:HTMLElement,controller:WorkspaceController,section:EditableSection,title:string,render:(root:HTMLElement,context:FieldContext)=>void,makeNew?:()=>RawObject,ui?:IssueViewContext,heading=title,options?:FormRenderOptions):void {
  if(options){if(options.section===section)renderRecordForm(root,controller,section,options.recordId,title,render,ui,options);return;}
  ui?.disclosures.closeWithin(root,false);root.replaceChildren();if(heading)root.append(element('h2',heading));
  const state=controller.getState();const records=section==='household'?['household']:[...new Set([...((state.savedPlan[section]??[]) as readonly {id:string}[]).map(r=>r.id),...Object.values(state.drafts).filter(d=>d.section===section).map(d=>d.recordId)])];
  for(const id of records){const card=element('form');card.dataset.recordId=id;card.dataset.editableSection=section;card.append(element('h3',section==='household'?'Applied household inputs':String(controller.getDraft(section,id).value.name??'New record')));const body=element('div');body.className='record-fields';card.append(body);
    const context:FieldContext={...(ui?{ui}:{}),get draft(){return controller.getDraft(section,id);},get issues(){return controller.getState().issues.filter(i=>i.recordId===id||section==='household');},onChange(path,value){const draft=controller.getDraft(section,id);controller.editDraft(id,{...draft,value:setAt(draft.value,path,value)});},refresh(){ui?.disclosures.closeWithin(body,false);refreshFields(body,()=>render(body,context));if(ui)syncFormFeedback(root,controller,ui);}};
    context.refresh();
    const save=element('button',section==='household'?'Save household':`Save ${title==='Income'?'income':title==='Investments'?'investment':title.toLowerCase()}`);save.type='submit';card.append(save);card.addEventListener('submit',event=>{event.preventDefault();controller.saveRecord(id);});
    card.append(element('small','Discards this draft and reloads applied inputs.'),button('Discard edits',()=>{controller.discardDraft(id);renderRecordSection(root,controller,section,title,render,makeNew,ui,heading);}));
    if(section!=='household')card.append(button(`Remove ${String(controller.getDraft(section,id).value.name??'record')}`,()=>controller.removeRecord(section,id)));
    root.append(card);
  }
  if(ui)syncFormFeedback(root,controller,ui);
  if(section!=='household')root.append(button(`Add ${title.toLowerCase()}`,()=>controller.beginAdd(section,makeNew?.())));
}
