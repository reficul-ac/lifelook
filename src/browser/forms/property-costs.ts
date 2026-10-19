import { button,element,taxCategoryOptions,type FieldContext,type FieldPath } from '../fields';
import { isFuturePropertyPurchase } from '../purchase-property-setup';
import { idFor } from '../record-ids';
import {fieldMemory,fieldModeKey,swapMode} from '../record-ui-state';
import { type RawObject,type WorkspaceController } from '../state';
import { allocationFields,at,booleanHistory,disclosureRoots,displayed,field,group,ownerFor,rentalOptions } from './property-fields-shared';
function renderExpense(root:HTMLElement,controller:WorkspaceController,context:FieldContext,path:FieldPath):void {
  const expense=at(context,path) as RawObject,node=group(root,`Property expense — ${String(expense.name??expense.id)}`);
  field(node,context,[...path,'name'],'Property expense name');field(node,context,[...path,'amountCents'],'Property expense amount',{kind:'money'});field(node,context,[...path,'frequency'],'Property expense frequency',{kind:'select',options:['monthly','annual'],hint:'Annual amounts are divided by 12 and budgeted monthly.'});field(node,context,[...path,'startDate'],'Property expense start date',{kind:'date',hint:'Monthly budgets begin on this date; no daily proration. Shorter months use their last day.'});field(node,context,[...path,'endDate'],'Property expense end date (optional)',{kind:'date',optional:true});field(node,context,[...path,'annualGrowthBps'],'Property expense annual growth (%)',{kind:'rate'});
  field(node,context,[...path,'taxCategory'],'Property expense category',{kind:'select',options:taxCategoryOptions,refresh:true});
  field(node,context,[...path,'use'],'Property expense use',{kind:'select',options:['personal','rental','shared'],refresh:true});
  if(at(context,[...path,'use'])==='rental')field(node,context,[...path,'rentalId'],'Direct expense rental unit',{kind:'select',options:rentalOptions(controller,context,context.draft.recordId)});
  if(at(context,[...path,'use'])==='shared'){
    const override=[...path,'allocationOverride'];field(node,displayed(context,override,at(context,override)?'explicit':'default',value=>{const current=at(context,override) as RawObject|undefined,restored=swapMode(fieldMemory(context),`share:${fieldModeKey(context,override)}`,current?'explicit':'default',String(value),current??{},{numerator:'',denominator:''});context.onChange(override,value==='explicit'?restored:undefined);context.refresh();}),override,'Expense shared allocation',{kind:'select',options:[{value:'default',label:'Default rental allocation'},{value:'explicit',label:'Explicit expense share'}]});
    if(at(context,override))allocationFields(node,context,override);
  }
  if(at(context,[...path,'taxCategory'])==='mortgage-insurance')booleanHistory(node,context,[...path,'mortgageInsuranceQualification'],'Personal mortgage insurance qualified');
}

export function renderPropertyCosts(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const property=at(context,['property']) as RawObject,future=isFuturePropertyPurchase(property,controller.getState().savedPlan.startYear),related=root;
  for(const [index]of (at(context,['expenses']) as readonly RawObject[]).entries()){const section=element('section');disclosureRoots.set(section,ownerFor(root));renderExpense(section,controller,context,['expenses',index]);section.append(button('Remove property expense',()=>{context.onChange(['expenses'],(at(context,['expenses']) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));related.append(section);}
  related.append(button('Add property expense',()=>{context.onChange(['expenses'],[...(at(context,['expenses']) as readonly RawObject[]),{id:idFor(controller,context,'expense'),name:'Property expense',amountCents:'0.00',frequency:'monthly',startDate:future?at(context,['property','purchaseDate']):`${controller.getState().savedPlan.startYear}-01-01`,annualGrowthBps:'0.00',propertyId:context.draft.recordId,use:future&&property.role==='rental'?'rental':'personal',...(future&&property.role==='rental'?(at(context,['rentals']) as readonly RawObject[])[0]?{rentalId:(at(context,['rentals']) as readonly RawObject[])[0]!.id}:{}:{}),taxCategory:'personal'}]);context.refresh();}));

}
