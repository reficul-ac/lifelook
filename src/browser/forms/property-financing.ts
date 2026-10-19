import { initializePurchaseLoan,type PropertyLoan,type PurchaseLoanInput } from '../../engine';
import { calculateLoanSchedule,scheduledPayment } from '../../engine/property/loans';
import { button,element,type FieldContext,type FieldPath } from '../fields';
import { registerFormSummary,setFormTaskIssues,syncFormFeedback } from '../form-feedback';
import { isFuturePropertyPurchase,purchaseFirstPaymentDate } from '../purchase-property-setup';
import { idFor } from '../record-ids';
import { fieldMemory,swapMode } from '../record-ui-state';
import { fromDraftValue,toDraftValue,type RawObject,type WorkspaceController } from '../state';
import { formatCents } from '../views/issues';
import { allocationFields,at,booleanHistory,details,disclosureRoots,displayed,field,group,moneyHistory,ownerFor,propertyOptions,rentalOptions,rows,unknown } from './property-fields-shared';
function purchaseTerms(context:FieldContext,loan:RawObject) {
  const decoded=fromDraftValue({purchasePriceCents:at(context,['property','purchasePriceCents']),downPaymentCents:at(context,['property','downPaymentCents']),aprBps:loan.aprBps,termMonths:loan.termMonths},String(loan.id));
  return decoded.issues.length?{status:'needs-data' as const,issues:decoded.issues}:initializePurchaseLoan(decoded.value as unknown as PurchaseLoanInput);
}
function loanWithTerms(loan:RawObject,result:{originalPrincipalCents:number;monthlyPaymentCents:number}):RawObject {
  const entered=toDraftValue(result) as RawObject;
  return {...loan,originalPrincipalCents:entered.originalPrincipalCents,__draft:{paymentEstimate:entered.monthlyPaymentCents}};
}
function loanStatus(context:FieldContext,controller:WorkspaceController,path:FieldPath):string {const decoded=fromDraftValue(at(context,path),context.draft.recordId);if(decoded.issues.length)return 'Opening inputs unavailable';try{const schedule=calculateLoanSchedule(decoded.value as unknown as PropertyLoan,controller.getState().savedPlan.startYear,1);return `Opening balance ${schedule.openingProvenance==='known'?'entered':'estimated'}`;}catch{return 'Opening inputs unavailable';}}
function renderLoan(root:HTMLElement,controller:WorkspaceController,context:FieldContext,path:FieldPath):void {
  const loan=at(context,path) as RawObject,future=isFuturePropertyPurchase(at(context,['property']),controller.getState().savedPlan.startYear),saved=controller.getState().projection.loanSchedules.find(s=>s.loanId===loan.id&&s.year===controller.getState().savedPlan.startYear);
  if(future){
    const basic=group(root,`Mortgage — ${String(loan.name??loan.id)}`);basic.dataset.fieldGroup=path.join('.');
    field(basic,context,[...path,'originalPrincipalCents'],'Mortgage amount',{kind:'money',refresh:true});field(basic,context,[...path,'aprBps'],'Mortgage APR (%)',{kind:'rate',refresh:true});field(basic,context,[...path,'termMonths'],'Mortgage term (months)',{kind:'integer',refresh:true});field(basic,context,[...path,'firstPaymentDate'],'First payment date',{kind:'date'});
    const parsed=fromDraftValue({originalPrincipalCents:loan.originalPrincipalCents,aprBps:loan.aprBps,termMonths:loan.termMonths},String(loan.id));
    if(!parsed.issues.length)try{basic.append(element('p',`Estimated monthly principal & interest: ${formatCents(scheduledPayment(Number(parsed.value.originalPrincipalCents),Number(parsed.value.aprBps),Number(parsed.value.termMonths)))}. Property tax and insurance are separate expenses.`));}catch{/* Invalid terms retain their entered text until Save. */}
  }
  const status=loanStatus(context,controller,path);const disclosure=details(root,`${future?'Advanced mortgage details':'Loan'} — ${String(loan.name??loan.id)}`,{key:`${String(loan.id)}:loan`,initialOpen:!future&&!controller.getState().savedPlan.properties.some(p=>p.loans.some(l=>l.id===loan.id)),status});disclosure.dataset.fieldGroup=future?`${path.join('.')}.advanced`:path.join('.');registerFormSummary(disclosure,()=>loanStatus(context,controller,path));const node=group(disclosure,'Loan terms');
  field(node,context,[...path,'name'],'Loan name');if(!future){field(node,context,[...path,'originalPrincipalCents'],'Original principal',{kind:'money'});field(node,context,[...path,'aprBps'],'Nominal APR (%)',{kind:'rate'});}
  for(const [key,label]of [['originationDate','Origination date'],['acquisitionDate','Acquisition date'],...(!future?[['firstPaymentDate','First payment date']]:[])] as const)field(node,context,[...path,key!],label!,{kind:'date'});
  if(!future)field(node,context,[...path,'termMonths'],'Term (months)',{kind:'integer'});field(node,context,[...path,'collateralPropertyId'],'Collateral property',{kind:'select',options:propertyOptions(controller,context)});
  moneyHistory(node,context,[...path,'openingBalance'],'Opening mortgage balance',true);moneyHistory(node,context,[...path,'openingPayment'],'Opening principal-and-interest payment',true);
  node.append(element('p','Exclude property tax and insurance from loan payments.'));
  if(saved?.schedule.status==='available')node.append(element('p',`Saved opening balance: ${saved.schedule.value.openingProvenance}; saved payment: ${saved.schedule.value.paymentProvenance}. Exclude property tax and insurance.`));
  field(node,context,[...path,'proceedsQualification','kind'],'Proceeds type',{kind:'select',options:[{value:'acquisition',label:'Purchase/acquisition'},{value:'refinance',label:'Refinance'},{value:'cash-out',label:'Cash-out'},{value:'mixed',label:'Mixed proceeds'},{value:'grandfathered',label:'Grandfathered debt'},{value:'unknown',label:'Unknown'}],refresh:true});
  if(at(context,[...path,'proceedsQualification','kind'])==='acquisition')node.append(button('Calculate purchase loan',()=>{
    const current=at(context,path) as RawObject,result=purchaseTerms(context,current);
    if(result.status!=='available'){const form=node.closest<HTMLElement>('form')!;setFormTaskIssues(form,result.issues.map(issue=>({...issue,recordId:String(current.id),...(issue.field==='purchasePriceCents'||issue.field==='downPaymentCents'?{recordId:context.draft.recordId,field:'property.'+issue.field}:{})})),context.ui?.editorView);if(context.ui)syncFormFeedback(ownerFor(root),controller,context.ui);return;}
    setFormTaskIssues(node.closest<HTMLElement>('form')!,[],context.ui?.editorView);
    context.onChange(path,loanWithTerms(current,result.value));context.refresh();
  }));
  const estimate=at(context,[...path,'__draft','paymentEstimate']);if(estimate!==undefined)node.append(element('p',`Estimated monthly principal & interest: $${String(estimate)} per month.`));
  booleanHistory(node,context,[...path,'proceedsQualification','qualifiedAcquisitionDebt'],'Qualified acquisition debt');moneyHistory(node,context,[...path,'proceedsQualification','qualifiedPrincipalCents'],'Qualified acquisition principal');booleanHistory(node,context,[...path,'proceedsQualification','historyComplete'],'Complete proceeds history');booleanHistory(node,context,[...path,'financingAtRiskQualification'],'Financing qualifies for at-risk rules');
  rows(node,context,[...path,'proceedsAllocations'],'Loan proceeds allocation','Add loan proceeds allocation','Remove loan proceeds allocation',()=>({propertyId:context.draft.recordId,use:'personal',share:{numerator:'',denominator:''}}),(row,p)=>{
    field(row,context,[...p,'propertyId'],'Proceeds property',{kind:'select',options:propertyOptions(controller,context),refresh:true});field(row,context,[...p,'use'],'Proceeds use',{kind:'select',options:['personal','rental'],refresh:true});
    if(at(context,[...p,'use'])==='rental')field(row,context,[...p,'rentalId'],'Proceeds rental unit',{kind:'select',options:rentalOptions(controller,context,String(at(context,[...p,'propertyId'])??''))});
    allocationFields(row,context,[...p,'share']);
  });
}
function purchaseFundingFields(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
  const path=['property','purchaseFunding'],funding=at(context,path),source=funding?.kind==='taxable-brokerage'?String(funding.accountId):'household-cash';
  const brokerages=controller.getState().savedPlan.accounts.filter(account=>account.type==='taxable-brokerage'),selected=brokerages.find(account=>account.id===source);
  const adapted=displayed(context,path,source,value=>context.onChange(path,value==='household-cash'?{kind:'household-cash'}:{kind:'taxable-brokerage',accountId:String(value)}));
  field(root,adapted,path,'Pay down payment from',{kind:'select',options:[{value:'household-cash',label:'Household cash'},...brokerages.map(account=>({value:account.id,label:account.name})),...(source!=='household-cash'&&!selected?[{value:source,label:`Unavailable account (${source})`}]:[])],refresh:true,hint:'Paid in the purchase month. Brokerage sales also cover the estimated capital gains tax; mortgage payments and operating expenses use household cash.'});
  if(source!=='household-cash'){
    if(selected){
      root.append(element('p',`Opening account balance: ${formatCents(selected.openingBalanceCents)}`));
      root.append(element('p',selected.openingTaxableBasis?.known?`Investment cost basis: ${formatCents(selected.openingTaxableBasis.value)}`:'Investment cost basis: Unknown. Funding estimates use a zero-basis planning assumption until you enter the amount paid for investments still owned.'));
      root.append(element('small','Planning assumes proportional sales of long-term holdings. Realized losses receive no modeled tax benefit.'));
      if(context.ui)root.append(button('Edit account cost basis',()=>context.ui!.review({section:'Investments',recordId:selected.id,field:'openingTaxableBasis.known',label:'Edit account cost basis'})));
      else root.append(element('small','Edit this account’s investment cost basis in Investments.'));
    }else root.append(element('p','Choose a saved taxable brokerage account or household cash. The selected account is unavailable.'));
  }
  const estimationPath=['property','purchaseTaxEstimation'],estimation=at(context,estimationPath),mode=estimation?.mode??'simple';
  const modeContext=displayed(context,[...estimationPath,'mode'],mode,value=>context.onChange(estimationPath,swapMode(fieldMemory(context),'property-purchase-tax',String(mode),String(value),at(context,estimationPath)??{mode:'simple',buildingShareBps:'80.00'},value==='simple'?{mode:'simple',buildingShareBps:'80.00'}:{mode:'detailed'})));
  field(root,modeContext,[...estimationPath,'mode'],'Purchase tax calculation',{kind:'select',options:[{value:'simple',label:'Planning estimates'},{value:'detailed',label:'Detailed tax inputs'}],refresh:true});
  if(mode==='simple'){
    if(at(context,['property','role'])!=='primary')field(root,context,[...estimationPath,'buildingShareBps'],'Estimated building share (%)',{kind:'rate',hint:'The rest of the purchase price is land. Only the building share depreciates.'});
    root.append(element('small','Planning estimates use ordinary acquisition financing and residential rental tax assumptions. Confirmed tax inputs override estimates; detailed inputs are available below.'));
  }
}

export function renderPropertyFinancing(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const path=['property'],property=at(context,path) as RawObject,future=isFuturePropertyPurchase(property,controller.getState().savedPlan.startYear);
 if(future&&!property.aduProject)purchaseFundingFields(root,controller,context);
  const loans=at(context,[...path,'loans']) as readonly RawObject[],loanGroup=element('section');loanGroup.dataset.fieldGroup='property.loans';loanGroup.dataset.groupLabel='Property mortgages';root.append(loanGroup);
  for(const [index]of loans.entries()){const section=element('section');disclosureRoots.set(section,ownerFor(root));renderLoan(section,controller,context,[...path,'loans',index]);section.append(button('Remove loan',()=>{context.onChange([...path,'loans'],(at(context,[...path,'loans']) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));loanGroup.append(section);}
  loanGroup.append(button('Add loan',()=>{
    const date=`${controller.getState().savedPlan.startYear}-01-01`,purchaseDate=at(context,['property','purchaseDate']),loan:RawObject={id:idFor(controller,context,'loan'),name:'Purchase loan',originalPrincipalCents:'',aprBps:'0.00',originationDate:purchaseDate,acquisitionDate:purchaseDate,termMonths:'360',firstPaymentDate:future?purchaseFirstPaymentDate(purchaseDate)??purchaseDate:`${date.slice(0,7)}-31`,openingBalance:unknown(),openingPayment:unknown(),collateralPropertyId:context.draft.recordId,proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:unknown(),qualifiedPrincipalCents:unknown(),historyComplete:unknown()},proceedsAllocations:[],financingAtRiskQualification:unknown()},initialized=purchaseTerms(context,loan);
    context.onChange([...path,'loans'],[...(at(context,[...path,'loans']) as readonly RawObject[]),initialized.status==='available'?loanWithTerms(loan,initialized.value):loan]);context.refresh();
  }));

}
