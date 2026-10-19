import { type TaxBook } from '../../engine';
import { button,element,renderBooleanHistory,renderField,setAt,valueAt,type FieldContext,type FieldOptions,type FieldPath } from '../fields';
import { fieldMemory,swapMode } from '../record-ui-state';
import { type RawObject,type WorkspaceController } from '../state';
export const books:readonly [TaxBook,string][]=[['federal','Federal rental tax history'],['california','California rental tax history'],['federal-amt','Federal AMT rental tax history'],['california-amt','California AMT rental tax history']];
export const bookAmounts:readonly [string,string][]=[['recoveryBasisCents','Original building recovery basis (excludes land)'],['adjustedBuildingBasisCents','Adjusted building basis'],['cumulativeDepreciationCents','Prior depreciation'],['atRiskCents','Opening amount at risk'],['atRiskSuspendedCents','Suspended at-risk losses'],['passiveSuspendedCents','Suspended passive losses']];
export const zeroBook={recoveryBasisCents:0,adjustedBuildingBasisCents:0,cumulativeDepreciationCents:0,atRiskCents:0,atRiskSuspendedCents:0,passiveSuspendedCents:0,lossVintages:[]};
export const unknown=()=>({known:false});
export function group(root:HTMLElement,name:string):HTMLFieldSetElement {const node=element('fieldset');node.append(element('legend',name));root.append(node);return node;}
interface PropertyDisclosureOptions {readonly key:string;readonly initialOpen?:boolean;readonly status?:string}
export const disclosureStates=new WeakMap<HTMLElement,Map<string,boolean>>();
export const disclosureRoots=new WeakMap<HTMLElement,HTMLElement>();
export function ownerFor(node:HTMLElement):HTMLElement {for(let parent:HTMLElement|null=node;parent;parent=parent.parentElement){const owner=disclosureRoots.get(parent);if(owner)return owner;}return node;}
export function captureDisclosures(root:HTMLElement):void {const owner=ownerFor(root),state=disclosureStates.get(owner)??new Map<string,boolean>();for(const node of root.querySelectorAll<HTMLDetailsElement>('details[data-property-disclosure]'))state.set(node.dataset.propertyDisclosure!,node.open);disclosureStates.set(owner,state);}
export function details(root:HTMLElement,name:string,options:PropertyDisclosureOptions):HTMLDetailsElement {
  const owner=ownerFor(root),state=disclosureStates.get(owner)??new Map<string,boolean>();disclosureStates.set(owner,state);
  const node=element('details');node.dataset.propertyDisclosure=options.key;node.dataset.disclosureName=name;node.dataset.disclosureStatus=options.status??'';node.open=state.get(options.key)??options.initialOpen??false;state.set(options.key,node.open);disclosureRoots.set(node,owner);
  node.append(element('summary',name+(options.status?' · '+options.status:'')));node.addEventListener('toggle',()=>{if(node.isConnected)state.set(options.key,node.open);});root.append(node);return node;
}
export function unknownCount(value:unknown):number {if(!value||typeof value!=='object')return 0;if('known' in value)return value.known?0:1;return Object.values(value).reduce<number>((count,item)=>count+unknownCount(item),0);}

export function at(context:FieldContext,path:FieldPath):any{return valueAt(context.draft.value,path);}
export function field(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:FieldOptions={}):void {renderField(root,context,path,label,options);}
export function displayed(context:FieldContext,path:FieldPath,value:unknown,change:(value:unknown)=>void):FieldContext {
  return {...context,get draft(){return {...context.draft,value:setAt(context.draft.value,path,value)};},get issues(){return context.issues;},onChange(_path,value){change(value);},refresh(){context.refresh();}};
}
export function booleanHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string):void {
  const help:Record<string,string>={'Active participation':'Participation in rental management decisions is independent of floor area or ownership share.','Qualified acquisition debt':'Loan proceeds must qualify as acquisition debt under the applicable mortgage-interest rules.','QBI qualification':'Qualified business income eligibility depends on rental business facts; it is independent of cash flow.'};renderBooleanHistory(root,context,path,label,help[label]?{help:help[label]}:{});
}
export function moneyHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,estimate=false):void {
  const history=at(context,path) as {known?:boolean;value?:string}|undefined;
  field(root,displayed(context,path,history?.known?'known':'unknown',value=>{const current=at(context,path) as RawObject|undefined,from=current?.known?'known':'unknown',to=String(value),fallback=to==='known'?{known:true,value:''}:unknown();context.onChange(path,context.memory?swapMode(fieldMemory(context),`history:${path.join('.')}`,from,to,current??unknown(),fallback):fallback);context.refresh();}),path,`${label} history`,{kind:'select',options:[{value:'unknown',label:estimate?'Use schedule estimate':'Unknown'},{value:'known',label:estimate?'Enter known value':'Enter value'}]});
  if(history?.known)field(root,context,[...path,'value'],label,{kind:'money'});
}
export function rows(root:HTMLElement,context:FieldContext,path:FieldPath,legend:string,addLabel:string,removeLabel:string,create:()=>RawObject,render:(root:HTMLElement,path:FieldPath,index:number)=>void):void {
  const values=at(context,path) as readonly RawObject[]|undefined;
  for(const [index] of (values??[]).entries()){
    const row=group(root,`${legend} ${index+1}`);render(row,[...path,index],index);
    row.append(button(removeLabel,()=>{context.onChange(path,(at(context,path) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));
  }
  root.append(button(addLabel,()=>{context.onChange(path,[...((at(context,path) as readonly RawObject[])??[]),create()]);context.refresh();}));
}
interface Choice {readonly value:string;readonly label:string}
interface NamedProperty {readonly id:string;readonly name:string;readonly role:string;readonly loans:readonly {id:string;name:string}[]}
export function propertyRecords(controller:WorkspaceController,context:FieldContext):readonly NamedProperty[] {
  return [...controller.getState().savedPlan.properties.filter(p=>p.id!==context.draft.recordId),at(context,['property']) as NamedProperty];
}
export function propertyOptions(controller:WorkspaceController,context:FieldContext):readonly Choice[] {
  return propertyRecords(controller,context).map(p=>({value:p.id,label:p.name||'Current property'}));
}
export function rentalOptions(controller:WorkspaceController,context:FieldContext,propertyId?:string):readonly Choice[] {
  return propertyRecords(controller,context).filter(p=>!propertyId||p.id===propertyId).flatMap(property=>{
    const units=property.id===context.draft.recordId?at(context,['rentals']) as readonly {id:string}[]:controller.getState().savedPlan.rentals.filter(r=>r.propertyId===property.id);
    const kind=property.role==='primary-with-adu'?'ADU':property.role==='rental'?'Whole rental':'Rental unit';
    return units.map((unit,index)=>({value:unit.id,label:`${kind} ${index+1} — ${property.name||'Current property'}`}));
  });
}
export function loanOptions(controller:WorkspaceController,context:FieldContext):readonly Choice[] {
  return propertyRecords(controller,context).flatMap(property=>property.loans.map((loan,index)=>({value:loan.id,label:`${loan.name||`Loan ${index+1}`} — ${property.name||'Current property'}`})));
}
export function allocationFields(root:HTMLElement,context:FieldContext,path:FieldPath):void {
  field(root,context,[...path,'numerator'],'Rental portion',{kind:'integer'});field(root,context,[...path,'denominator'],'Total portions',{kind:'integer',hint:'1 of 4 = 25%.'});
}
