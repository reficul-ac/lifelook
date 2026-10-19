import { Decimal,settleCents } from '../../engine/money';
import { button,element,type FieldContext,type FieldPath } from '../fields';
import { registerFormSummary } from '../form-feedback';
import { createPropertyRentalDraft,isFuturePropertyPurchase } from '../purchase-property-setup';
import { idFor } from '../record-ids';
import { fromDraftValue,type RawObject,type WorkspaceController } from '../state';
import { formatCents } from '../views/issues';
import { allocationFields,at,booleanHistory,details,disclosureRoots,displayed,field,group,loanOptions,moneyHistory,ownerFor,propertyRecords,rentalOptions,unknown,unknownCount } from './property-fields-shared';
function renderRental(root:HTMLElement,controller:WorkspaceController,context:FieldContext,path:FieldPath):void {
  const unit=at(context,path) as RawObject,future=isFuturePropertyPurchase(at(context,['property']),controller.getState().savedPlan.startYear),unitLabel=rentalOptions(controller,context,context.draft.recordId).find(option=>option.value===unit.id)?.label.split(' — ')[0]??'Rental unit',disclosure=future?root:details(root,`Rental unit — ${unitLabel}`,{key:`${String(unit.id)}:rental`,initialOpen:!controller.getState().savedPlan.rentals.some(r=>r.id===unit.id),status:`${unknownCount(unit)} unknown facts`});let node:HTMLElement=group(disclosure,'Rental details');disclosure.dataset.fieldGroup=path.join('.');if(disclosure instanceof HTMLDetailsElement)registerFormSummary(disclosure,()=>`${unknownCount(at(context,path))} unknown facts`);
  const project=at(context,['property','aduProject']) as RawObject|undefined,isProject=project?.rentalId===unit.id;
  if(!isProject)field(node,context,[...path,'monthlyRentCents'],'Monthly rent receipts',{kind:'money'});field(node,context,[...path,'rentGrowthBps'],'Effective annual rent growth (%)',{kind:'rate'});field(node,context,[...path,'rentStartDate'],'Lease income start date',{kind:'date'});field(node,context,[...path,'rentEndDate'],'Lease income end date (optional)',{kind:'date',optional:true});field(node,context,[...path,'availableDate'],'Available for rent date',{kind:'date'});
  node.append(element('p',isProject?'Rental readiness starts depreciation; lease income can begin later. New-rental prior history starts at zero.':future?'Rental income and depreciation begin after purchase when the rental is ready. Building basis excludes land.':'Available by forecast start; rent may begin later. Building basis excludes land and differs from market value.'));
  if(isProject){field(node,context,[...path,'vacancyBps'],'Vacancy allowance (%)',{kind:'rate',optional:true,refresh:true});const parsed=fromDraftValue({monthlyRentCents:at(context,[...path,'monthlyRentCents']),vacancyBps:at(context,[...path,'vacancyBps'])??'0.00'},context.draft.recordId);let collected='Needs valid rent and vacancy';if(!parsed.issues.length)try{collected=formatCents(settleCents(new Decimal(parsed.value.monthlyRentCents as number).mul(new Decimal(10000).minus(parsed.value.vacancyBps as number)).div(10000)));}catch{}const preview=element('p',`Expected collected rent: ${collected} per full leased month`);preview.dataset.testid='adu-draft-collected-rent';node.append(preview);}
  if(future)node=details(node,'Advanced rental tax details',{key:`${String(unit.id)}:rental-tax`});
  booleanHistory(node,context,[...path,'activeParticipation'],'Active participation');
  for(const [key,label]of [['longTermFairMarketLease','Long-term fair-market lease'],['noPersonalUse','Rental has no personal use'],['noSubstantialTenantServices','No substantial tenant services'],['ordinaryResidential','Ordinary residential rental'],['advancedBasisAdjustments','Advanced basis adjustments apply'],['californiaSmallBusinessQualification','California AMT small-business qualification']] as const)booleanHistory(node,context,[...path,'qualifications',key],label);
  if(!isProject){field(node,displayed(context,[...path,'sharedAllocation'],at(context,[...path,'sharedAllocation'])?'explicit':'default',value=>{context.onChange([...path,'sharedAllocation'],value==='explicit'?{numerator:'',denominator:''}:undefined);context.refresh();}),[...path,'sharedAllocation'],'Shared-cost allocation',{kind:'select',options:[{value:'default',label:'Default property / area allocation'},{value:'explicit',label:'Explicit share'}]});
  if(at(context,[...path,'sharedAllocation']))allocationFields(node,context,[...path,'sharedAllocation']);
  const converted=displayed(context,[...path,'convertedFromPersonalUse'],String(at(context,[...path,'convertedFromPersonalUse'])??false),value=>{context.onChange([...path,'convertedFromPersonalUse'],value==='true');context.refresh();});
  field(node,converted,[...path,'convertedFromPersonalUse'],'Converted from personal use',{kind:'select',options:[{value:'false',label:'No'},{value:'true',label:'Yes'}]});
  if(at(context,[...path,'convertedFromPersonalUse']))moneyHistory(node,context,[...path,'conversionBuildingFmv'],'Building fair market value at conversion');
  const allocations=at(context,[...path,'loanAllocations']) as readonly RawObject[];
  for(const [index,allocation]of allocations.entries()){
    const p=[...path,'loanAllocations',index],choices=loanOptions(controller,context),loanName=propertyRecords(controller,context).flatMap(property=>property.loans).find(loan=>loan.id===allocation.loanId)?.name??'Removed loan reference',section=group(node,`Rental interest allocation — ${loanName}`);
    field(section,context,[...p,'loanId'],'Allocated loan',{kind:'select',options:choices});allocationFields(section,context,[...p,'share']);booleanHistory(section,context,[...p,'qualification'],'Rental proceeds and interest qualified');
    section.append(button('Remove rental interest allocation',()=>{context.onChange([...path,'loanAllocations'],(at(context,[...path,'loanAllocations']) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));
  }
  node.append(button('Add rental interest allocation',()=>{const loans=at(context,['property','loans']) as readonly RawObject[];context.onChange([...path,'loanAllocations'],[...(at(context,[...path,'loanAllocations']) as readonly RawObject[]),{loanId:String(loans[0]?.id??''),share:{numerator:'',denominator:''},qualification:unknown()}]);context.refresh();}));
  }
}

export function renderPropertyRentals(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const property=at(context,['property']) as RawObject,future=isFuturePropertyPurchase(property,controller.getState().savedPlan.startYear),related=root;
  const rentals=at(context,['rentals']) as readonly RawObject[];
  for(const [index,unit]of rentals.entries()){const section=element('section');disclosureRoots.set(section,ownerFor(root));renderRental(section,controller,context,['rentals',index]);if(!property.aduProject)section.append(button('Remove rental unit',()=>{context.onChange(['rentals'],(at(context,['rentals']) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));related.append(section);}
  if(property.role!=='primary'&&!property.aduProject)root.append(button('Add rental unit',()=>{const date=future?String(at(context,['property','purchaseDate'])):`${controller.getState().savedPlan.startYear}-01-01`;context.onChange(['rentals'],[...(at(context,['rentals']) as readonly RawObject[]),createPropertyRentalDraft(at(context,['property']),date,idFor(controller,context,'rental'))]);context.refresh();}));

}
