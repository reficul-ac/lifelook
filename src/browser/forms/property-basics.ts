import { defaultRentalAllocation,type Property,type RentalUnit } from '../../engine';
import { element,type FieldContext } from '../fields';
import { isFuturePropertyPurchase } from '../purchase-property-setup';
import { fromDraftValue,type RawObject,type WorkspaceController } from '../state';
import { at,details,field,rows } from './property-fields-shared';
export function renderPropertyBasics(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const path=['property'],property=at(context,path) as RawObject,future=isFuturePropertyPurchase(property,controller.getState().savedPlan.startYear);
 const classification=element('p',`${future?'Purchase after forecast start':'Owned at forecast start'} · January 1, ${controller.getState().savedPlan.startYear}`);classification.dataset.propertyTiming=future?'future':'owned';root.append(classification);
  field(root,context,[...path,'name'],'Property name');field(root,context,[...path,'role'],'Property role',{kind:'select',options:[{value:'primary',label:'Primary home'},{value:'rental',label:'Whole-property rental'},{value:'primary-with-adu',label:'Primary home with ADU'}],refresh:true});if(property.aduProject){const role=root.querySelector<HTMLSelectElement>('[name="property.role"]');if(role)role.disabled=true;}
  field(root,context,[...path,'purchaseDate'],context.memory?'Property purchase date':'Purchase date',{kind:'date',refresh:true,hint:future?'The property and mortgage enter the forecast in the purchase month.':'Use the original purchase date, or enter a future closing date to plan a purchase.'});
  field(root,context,[...path,'purchasePriceCents'],'Purchase price',{kind:'money',refresh:future});field(root,context,[...path,'downPaymentCents'],'Down payment',{kind:'money',refresh:future});
  field(root,context,[...path,'openingValueCents'],future?'Property market value at purchase':property.aduProject?'Original home market value at forecast start':property.role==='primary-with-adu'?'Combined home and ADU market value at forecast start':'Property market value at forecast start',{kind:'money',hint:future?`As of ${String(property.purchaseDate)}. Defaults to the purchase price; enter a different estimate if needed.`:`As of Jan 1, ${controller.getState().savedPlan.startYear}.${property.aduProject?' Includes the existing home and land; added ADU value posts at completion.':property.role==='primary-with-adu'?' Includes the home and ADU together.':''}`});field(root,context,[...path,'appreciationBps'],'Effective annual appreciation (%)',{kind:'rate'});
  if(property.role==='primary-with-adu'&&!property.aduProject) {
    field(root,context,[...path,'primaryArea'],'Primary home living area',{kind:'text',hint:'Use the same area units for home and ADU; fractions are allowed.'});field(root,context,[...path,'aduArea'],'ADU living area',{kind:'text'});
    const decoded=fromDraftValue(context.draft.value,context.draft.recordId);
    if(decoded.issues.length===0){
      const defaultUnits=(decoded.value.rentals as readonly RentalUnit[]).map(({sharedAllocation:_override,...unit})=>unit);
      const allocation=defaultRentalAllocation(decoded.value.property as unknown as Property,defaultUnits);
      root.append(element('p',allocation.status==='available'?`Default ADU shared allocation: ${Object.values(allocation.value).join(', ')||'add a rental unit'}. Explicit expense and loan allocations remain independent.`:`Default ADU shared allocation unavailable: ${allocation.issues.map(i=>i.explanation).join(' ')}`));
    }else root.append(element('p','Default ADU shared allocation requires valid entered areas and amounts.'));
  }
  rows(details(root,'Yearly appreciation overrides',{key:`${context.draft.recordId}:appreciation`,status:`${(at(context,[...path,'appreciationOverrides']) as readonly unknown[]).length} overrides`}),context,[...path,'appreciationOverrides'],'Appreciation override','Add appreciation override','Remove appreciation override',()=>({year:'',rateBps:''}),(row,p)=>{field(row,context,[...p,'year'],'Appreciation year',{kind:'integer'});field(row,context,[...p,'rateBps'],'Appreciation rate (%)',{kind:'rate'});});

}
