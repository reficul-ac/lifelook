import type { Available,BasisPoints,Cents,Issue } from '../engine';
import { MAX_CENTS } from '../engine/money';
import type { EditableSection,RawObject,RecordDraft,WorkspaceController } from './state';

export type FieldPath=readonly (string|number)[];
export interface FieldContext {readonly draft:RecordDraft;readonly issues:readonly Issue[];onChange(path:FieldPath,value:unknown):void;refresh():void}
export interface FieldOptions {readonly kind?:'money'|'rate'|'integer'|'text'|'date'|'month'|'select'|'checkbox';readonly options?:readonly (string|Readonly<{value:string;label:string}>)[];readonly hint?:string;readonly optional?:boolean;readonly refresh?:boolean}
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
export function renderField(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:FieldOptions={}):HTMLInputElement|HTMLSelectElement {
  const wrapper=element('label'),caption=element('span',label);wrapper.append(caption);const kind=options.kind??'text';
  const control=kind==='select'?element('select'):element('input');control.name=path.join('.');control.dataset.field=path.join('.');control.setAttribute('aria-label',label);
  if(control instanceof HTMLSelectElement){for(const option of options.options??[]){const value=typeof option==='string'?option:option.value,name=typeof option==='string'?option:option.label;const child=element('option',name);child.value=value;control.append(child);}}
  else {control.type=kind==='checkbox'?'checkbox':kind==='date'?'date':kind==='month'?'month':'text';if(kind==='money'||kind==='rate')control.inputMode='decimal';if(kind==='integer')control.inputMode='numeric';}
  const value=valueAt(context.draft.value,path);
  if(control instanceof HTMLInputElement&&control.type==='checkbox')control.checked=value===true;else control.value=value===undefined?'':String(value);
  control.addEventListener(kind==='select'||kind==='checkbox'?'change':'input',()=>{const next=control instanceof HTMLInputElement&&control.type==='checkbox'?control.checked:control.value;context.onChange(path,options.optional&&next===''?undefined:next);if(options.refresh)context.refresh();});
  wrapper.append(control);if(options.hint)wrapper.append(element('small',options.hint));root.append(wrapper);return control;
}
export function renderHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:FieldOptions={}):void {
  const group=element('fieldset');group.append(element('legend',label));
  const history=valueAt(context.draft.value,path) as {known?:boolean;value?:unknown}|undefined;
  const select=element('select');select.dataset.field=[...path,'known'].join('.');select.setAttribute('aria-label',`${label} history`);const caption=element('label',`${label} history`);caption.append(select);group.append(caption);
  for(const [value,name] of [['unknown','Unknown'],['known','Known']] as const){const option=element('option',name);option.value=value;select.append(option);}select.value=history?.known?'known':'unknown';
  select.addEventListener('change',()=>{context.onChange(path,select.value==='unknown'?{known:false}:{known:true,value:options.kind==='checkbox'||options.kind==='select'?false:''});context.refresh();});
  if(history?.known){
    if(options.kind==='checkbox'||options.kind==='select'){
      const boolContext:FieldContext={...context,get draft(){return context.draft;},onChange(p,value){context.onChange(p,value==='true');}};
      renderField(group,boolContext,[...path,'value'],`${label} answer`,{kind:'select',options:[{value:'false',label:'No'},{value:'true',label:'Yes'}]});
    }else renderField(group,context,[...path,'value'],`${label} value`,options);
  }
  root.append(group);
}
export function renderRows(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,makeRow:()=>RawObject,renderRow:(root:HTMLElement,path:FieldPath,index:number)=>void):void {
  const group=element('fieldset');group.append(element('legend',label));const rows=valueAt(context.draft.value,path) as readonly RawObject[]|undefined;
  (rows??[]).forEach((_,index)=>{const row=element('fieldset');row.append(element('legend',`${label} ${index+1}`));renderRow(row,[...path,index],index);row.append(button(`Remove ${label} ${index+1}`,()=>{context.onChange(path,(valueAt(context.draft.value,path) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));group.append(row);});
  group.append(button(`Add ${label}`,()=>{context.onChange(path,[...((valueAt(context.draft.value,path) as readonly RawObject[])??[]),makeRow()]);context.refresh();}));root.append(group);
}
export function renderRecordSection(root:HTMLElement,controller:WorkspaceController,section:EditableSection,title:string,render:(root:HTMLElement,context:FieldContext)=>void,makeNew?:()=>RawObject):void {
  root.replaceChildren();root.append(element('h2',title));
  const state=controller.getState();const records=section==='household'?['household']:[...new Set([...(state.savedPlan[section] as readonly {id:string}[]).map(r=>r.id),...Object.values(state.drafts).filter(d=>d.section===section).map(d=>d.recordId)])];
  for(const id of records){const card=element('form');card.dataset.recordId=id;card.append(element('h3',section==='household'?'Household':String(controller.getDraft(section,id).value.name??'New record')));const body=element('div');body.className='record-fields';card.append(body);
    const context:FieldContext={get draft(){return controller.getDraft(section,id);},get issues(){return controller.getState().issues.filter(i=>i.recordId===id||section==='household');},onChange(path,value){const draft=controller.getDraft(section,id);controller.editDraft(id,{...draft,value:setAt(draft.value,path,value)});},refresh(){refreshFields(body,()=>render(body,context));}};
    context.refresh();
    const save=element('button',section==='household'?'Save household':`Save ${title==='Income'?'income':title==='Investments'?'investment':title.toLowerCase()} record`);save.type='submit';card.append(save);card.addEventListener('submit',event=>{event.preventDefault();controller.saveRecord(id);});
    card.append(button(`Discard ${title.toLowerCase()} record edits and reload saved values`,()=>{controller.discardDraft(id);renderRecordSection(root,controller,section,title,render,makeNew);}));
    if(section!=='household')card.append(button(`Remove ${String(controller.getDraft(section,id).value.name??'record')}`,()=>controller.removeRecord(section,id)));
    root.append(card);
  }
  if(section!=='household')root.append(button(`Add ${title.toLowerCase()}`,()=>controller.beginAdd(section,makeNew?.())));
}
