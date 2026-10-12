import type {IssueViewContext} from './issue-presentation';
import {syncFormFeedback} from './form-feedback';
import type { Available,BasisPoints,Cents,Issue } from '../engine';
import { MAX_CENTS } from '../engine/money';
import type { EditableSection,RawObject,RecordDraft,WorkspaceController } from './state';

export type FieldPath=readonly (string|number)[];
export interface FieldContext {readonly ui?:IssueViewContext;readonly draft:RecordDraft;readonly issues:readonly Issue[];onChange(path:FieldPath,value:unknown):void;refresh():void}
export interface FieldOptions {readonly visibleLabel?:string;readonly help?:string;readonly kind?:'money'|'rate'|'integer'|'text'|'date'|'month'|'select'|'checkbox';readonly options?:readonly (string|Readonly<{value:string;label:string}>)[];readonly hint?:string;readonly optional?:boolean;readonly refresh?:boolean}
function parseUnits(text:string,limit:number,label:string):Available<number>{
  const trimmed=text.trim();
  const issue:Issue={code:'invalid-input',field:label,severity:'error',explanation:`Enter ${label} as an ordinary decimal with at most two decimal places; blank is unknown.`,resolution:'Use digits and an optional decimal point, without exponents or separators.'};
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(trimmed))return {status:'needs-data',issues:[issue]};
  const negative=trimmed.startsWith('-'),unsigned=negative?trimmed.slice(1):trimmed,[whole='',fraction='']=unsigned.split('.');
  const exact=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(exact>BigInt(limit))return {status:'needs-data',issues:[{...issue,explanation:`This ${label} exceeds the supported input range.`}]};
  return {status:'available',value:Number(negative?-exact:exact)};
}
export const parseMoneyInput=(text:string):Available<Cents>=>parseUnits(text,MAX_CENTS,'money');
export const parseRateInput=(text:string):Available<BasisPoints>=>parseUnits(text,100000,'rate');
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
export function renderField(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:FieldOptions={}):HTMLInputElement|HTMLSelectElement {
  if(options.kind==='money'&&!label.includes('$'))label+=' ($)';
  const wrapper=element('div');wrapper.className='field-wrapper';wrapper.dataset.fieldWrapper='';const caption=element('label',options.visibleLabel??shortLabel(label));wrapper.append(caption);const kind=options.kind??'text';
  const control=kind==='select'?element('select'):element('input');control.id=`field-${++fieldSequence}`;caption.htmlFor=control.id;control.dataset.fieldLabel=label;control.dataset.fieldKind=kind;control.name=path.join('.');control.dataset.field=path.join('.');control.setAttribute('aria-label',label);
  if(control instanceof HTMLSelectElement){for(const option of options.options??[]){const value=typeof option==='string'?option:option.value,name=typeof option==='string'?option:option.label;const child=element('option',name);child.value=value;control.append(child);}}
  else {control.type=kind==='checkbox'?'checkbox':kind==='date'?'date':kind==='month'?'month':'text';if(kind==='money'||kind==='rate')control.inputMode='decimal';if(kind==='integer')control.inputMode='numeric';if(['primaryArea','aduArea'].includes(String(path[path.length-1])))control.inputMode='decimal';}
  const value=valueAt(context.draft.value,path);
  if(control instanceof HTMLInputElement&&control.type==='checkbox')control.checked=value===true;else control.value=value===undefined?'':String(value);
  control.addEventListener(kind==='select'||kind==='checkbox'?'change':'input',()=>{const next=control instanceof HTMLInputElement&&control.type==='checkbox'?control.checked:control.value;context.onChange(path,options.optional&&next===''?undefined:next);if(options.refresh)context.refresh();});
  wrapper.append(control);if(options.hint){const hint=element('small',options.hint);hint.id=`${control.id}-hint`;wrapper.append(hint);control.dataset.hintIds=hint.id;control.setAttribute('aria-describedby',hint.id);}if(options.help&&context.ui)wrapper.append(context.ui.disclosures.createTrigger({label:'ⓘ',accessibleLabel:`ⓘ About ${options.visibleLabel??shortLabel(label)}`,preview:options.help,title:label,renderDetails:node=>{node.textContent=options.help!;}}));const error=element('small');error.id=`${control.id}-error`;error.dataset.fieldError=path.join('.');error.className='field-error';wrapper.append(error);root.append(wrapper);return control;
}
export function renderBooleanHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:Pick<FieldOptions,'visibleLabel'|'hint'|'help'>={}):HTMLSelectElement {
  const history=valueAt(context.draft.value,path) as {known?:boolean;value?:boolean}|undefined;
  const choice:FieldContext={...context,get draft(){return {...context.draft,value:setAt(context.draft.value,path,history?.known?String(history.value):'unknown')};},onChange(_path,value){context.onChange(path,value==='unknown'?{known:false}:{known:true,value:value==='true'});}};
  return renderField(root,choice,path,label,{...options,kind:'select',options:[{value:'unknown',label:'Unknown'},{value:'true',label:'Yes'},{value:'false',label:'No'}]}) as HTMLSelectElement;
}
export function renderHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:FieldOptions={}):void {
  if(options.kind==='checkbox'||options.kind==='select'){renderBooleanHistory(root,context,path,label,options);return;}
  const group=element('fieldset');group.dataset.fieldGroup=path.join('.');group.dataset.groupLabel=label;group.append(element('legend',options.visibleLabel??shortLabel(label)));
  const history=valueAt(context.draft.value,path) as {known?:boolean;value?:unknown}|undefined;
  const statusContext:FieldContext={...context,get draft(){return {...context.draft,value:setAt(context.draft.value,[...path,'known'],history?.known?'known':'unknown')};},onChange(_path,value){context.onChange(path,value==='unknown'?{known:false}:{known:true,value:''});}};
  renderField(group,statusContext,[...path,'known'],`${label} history`,{kind:'select',visibleLabel:'history',...(options.hint?{hint:options.hint}:{}),options:[{value:'unknown',label:'Unknown'},{value:'known',label:'Enter value'}],refresh:true});
  if(history?.known){const {hint,...entryOptions}=options;renderField(group,context,[...path,'value'],`${label} value`,{...entryOptions,visibleLabel:'value'});}

  root.append(group);
}
export function renderRows(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,makeRow:()=>RawObject,renderRow:(root:HTMLElement,path:FieldPath,index:number)=>void):void {
  const group=element('fieldset');group.dataset.fieldGroup=path.join('.');group.dataset.groupLabel=label;group.append(element('legend',label));const rows=valueAt(context.draft.value,path) as readonly RawObject[]|undefined;
  (rows??[]).forEach((_,index)=>{const row=element('fieldset');row.append(element('legend',`${label} ${index+1}`));renderRow(row,[...path,index],index);row.append(button(`Remove ${label} ${index+1}`,()=>{context.onChange(path,(valueAt(context.draft.value,path) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));group.append(row);});
  group.append(button(`Add ${label}`,()=>{context.onChange(path,[...((valueAt(context.draft.value,path) as readonly RawObject[])??[]),makeRow()]);context.refresh();}));root.append(group);
}
export function renderRecordSection(root:HTMLElement,controller:WorkspaceController,section:EditableSection,title:string,render:(root:HTMLElement,context:FieldContext)=>void,makeNew?:()=>RawObject,ui?:IssueViewContext):void {
  ui?.disclosures.closeWithin(root,false);root.replaceChildren();root.append(element('h2',title));
  const state=controller.getState();const records=section==='household'?['household']:[...new Set([...(state.savedPlan[section] as readonly {id:string}[]).map(r=>r.id),...Object.values(state.drafts).filter(d=>d.section===section).map(d=>d.recordId)])];
  for(const id of records){const card=element('form');card.dataset.recordId=id;card.dataset.editableSection=section;card.append(element('h3',section==='household'?'Applied household inputs':String(controller.getDraft(section,id).value.name??'New record')));const body=element('div');body.className='record-fields';card.append(body);
    const context:FieldContext={...(ui?{ui}:{}),get draft(){return controller.getDraft(section,id);},get issues(){return controller.getState().issues.filter(i=>i.recordId===id||section==='household');},onChange(path,value){const draft=controller.getDraft(section,id);controller.editDraft(id,{...draft,value:setAt(draft.value,path,value)});},refresh(){ui?.disclosures.closeWithin(body,false);refreshFields(body,()=>render(body,context));if(ui)syncFormFeedback(root,controller,ui);}};
    context.refresh();
    const save=element('button',section==='household'?'Save household':`Save ${title==='Income'?'income':title==='Investments'?'investment':title.toLowerCase()}`);save.type='submit';card.append(save);card.addEventListener('submit',event=>{event.preventDefault();controller.saveRecord(id);});
    card.append(element('small','Discards this draft and reloads applied inputs.'),button('Discard edits',()=>{controller.discardDraft(id);renderRecordSection(root,controller,section,title,render,makeNew,ui);}));
    if(section!=='household')card.append(button(`Remove ${String(controller.getDraft(section,id).value.name??'record')}`,()=>controller.removeRecord(section,id)));
    root.append(card);
  }
  if(ui)syncFormFeedback(root,controller,ui);
  if(section!=='household')root.append(button(`Add ${title.toLowerCase()}`,()=>controller.beginAdd(section,makeNew?.())));
}
