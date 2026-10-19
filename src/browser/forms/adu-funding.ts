import type { Available,Cents } from '../../engine';
import { Decimal,settleCents } from '../../engine/money';
import { addSimpleAduFinancing,setSimpleAduLoanAmount } from '../adu-project-setup';
import { element,renderBooleanHistory,renderField,setAt,type FieldContext } from '../fields';
import { idFor } from '../record-ids';
import { fieldMemory,swapMode } from '../record-ui-state';
import { type RawObject,type WorkspaceController } from '../state';
import { formatCents } from '../views/issues';
import { aduPanels,createAduEnvironment,group,missing,unknownTreatments } from './adu-fields-shared';

export function renderAduFunding(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const {path,get,change,action,field,rows,treatments,bundle,replaceBundle,nextId,decode,singleCost,financePath,loan,detailedFinancing,simpleLoan,text,completed}=createAduEnvironment(root,controller,context);
 const {setup,main}=aduPanels(root);
 const fundingContext:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,financePath,loan?'loan':'cash')};},onChange(_p,value){const memory=fieldMemory(context),restored=swapMode(memory,'adu-financing',loan?'loan':'cash',String(value),loan?{financing:loan}:{},{});if(value==='loan'){if(restored.financing)context.onChange(financePath,restored.financing);else if(singleCost)replaceBundle(addSimpleAduFinancing(bundle(),nextId));else context.onChange(financePath,detailedFinancing());}else context.onChange(financePath,undefined);}};
 renderField(setup,fundingContext,financePath,'ADU funding',{kind:'select',options:[{value:'cash',label:'Cash'},{value:'loan',label:'Loan'}],refresh:true});
 const sourcePath=[...path,'ownerFunding'],source=get(sourcePath),sourceId=source?.kind==='taxable-brokerage'?String(source.accountId):'household-cash';
 const savedAccounts=controller.getState().savedPlan.accounts,brokerages=savedAccounts.filter(account=>account.type==='taxable-brokerage');
 const selectedAccount=brokerages.find(account=>account.id===sourceId);
 const sourceContext:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,sourcePath,sourceId)};},onChange(_p,value){context.onChange(sourcePath,value==='household-cash'?{kind:'household-cash'}:{kind:'taxable-brokerage',accountId:String(value)});}};
 renderField(setup,sourceContext,sourcePath,'Pay construction cash from',{kind:'select',options:[{value:'household-cash',label:'Household cash'},...brokerages.map(account=>({value:account.id,label:account.name})),...(sourceId!=='household-cash'&&!selectedAccount?[{value:sourceId,label:`Unavailable account (${sourceId})`}]:[])],refresh:true,hint:'Pays construction costs not covered by attributed loan proceeds, plus the estimated tax from investment sales. Operating expenses and loan payments use household cash.'});
 if(sourceId!=='household-cash'){
  if(selectedAccount){
   setup.append(element('p',`Opening account balance: ${formatCents(selectedAccount.openingBalanceCents)}`));
   const basis=selectedAccount.openingTaxableBasis;
   setup.append(element('p',basis?.known?`Investment cost basis: ${formatCents(basis.value)}`:'Investment cost basis: Unknown. Funding estimates use a zero-basis planning assumption until you enter account cost basis.'));
   setup.append(element('small','Planning assumes proportional sales of long-term holdings. Actual tax lots and holding periods can differ. Realized losses receive no modeled tax benefit.'));
   if(context.ui)setup.append(action('Edit account cost basis',()=>context.ui!.review({section:'Investments',recordId:selectedAccount.id,field:'openingTaxableBasis.known',label:'Edit account cost basis'})));
   else setup.append(element('small','Edit this account’s investment cost basis in Investments.'));
  }else setup.append(element('p','The selected funding account is unavailable or is no longer a taxable brokerage. Review it in Investments or choose another construction cash source.'));
 }
 if(loan){
  if(simpleLoan){
   const amountContext:FieldContext={...context,onChange(_p,value){replaceBundle(setSimpleAduLoanAmount(bundle(),String(value),nextId));}};
   renderField(setup,amountContext,[...financePath,'draws',0,'amountCents'],'ADU loan amount',{kind:'money',refresh:true});
  }else setup.append(element('p','Loan draws use a detailed schedule. Edit their amounts in Advanced ADU details.'));
  field(setup,[...financePath,'aprBps'],'ADU financing APR (%)',{kind:'rate'});field(setup,[...financePath,'termMonths'],'ADU financing term (months)',{kind:'integer'});
 }
 if(loan&&!simpleLoan){const parsed=decode({draws:(loan.draws as RawObject[]).map(draw=>({amountCents:draw.amountCents}))});let borrowed:Available<Cents>=missing();if(parsed)try{borrowed={status:'available',value:settleCents((parsed.draws as {amountCents:number}[]).reduce((sum,draw)=>sum.plus(draw.amountCents),new Decimal(0)))};}catch{}text(setup,'ADU loan amount',borrowed);}
 const financing=group(main,'Dedicated ADU financing',true);
 if(!loan)financing.append(element('p','Cash-funded construction; no loan receipts are planned.'),action('Add ADU financing',()=>change(financePath,detailedFinancing())));
 else{
  field(financing,[...financePath,'name'],'ADU financing name');field(financing,[...financePath,'firstAmortizingPaymentMonth'],'First amortizing payment month',{kind:'month'});
  rows(financing,[...financePath,'draws'],'Financing draw','Add financing draw','Remove financing draw',()=>({id:idFor(controller,context,'adu-draw'),month:String(get([...path,'constructionStartDate'])).slice(0,7),amountCents:'',costAllocations:[{costId:(get([...path,'costs']) as RawObject[])[0]?.id??'',amountCents:''}]}),(row,p)=>{
   field(row,[...p,'month'],'Draw month',{kind:'month'});if(!simpleLoan)field(row,[...p,'amountCents'],'Draw amount',{kind:'money'});
   rows(row,[...p,'costAllocations'],'Draw attribution','Add funded cost','Remove funded cost',()=>({costId:(get([...path,'costs']) as RawObject[])[0]?.id??'',amountCents:''}),(allocation,a)=>{field(allocation,[...a,'costId'],'Funded cost stage',{kind:'select',options:(get([...path,'costs']) as RawObject[]).map(c=>({value:String(c.id),label:String(c.name)}))});field(allocation,[...a,'amountCents'],'Draw amount attributed to stage',{kind:'money'});});
  });
  const tax=group(financing,'Interest tracing and construction treatment',true);for(const [key,label] of [['proceedsHistoryComplete','ADU proceeds tracing complete'],['rentalInterestQualified','ADU rental interest qualified'],['financingAtRiskQualification','ADU borrowing qualifies as amount at risk']] as const)renderBooleanHistory(tax,context,[...financePath,key],label);
  rows(tax,[...financePath,'interestTaxRows'],'Monthly interest treatment','Add interest tax row','Remove interest tax row',()=>({id:idFor(controller,context,'adu-interest'),month:String(completed).slice(0,7),treatments:unknownTreatments()}),(row,p)=>{field(row,[...p,'month'],'Interest treatment month',{kind:'month'});treatments(row,[...p,'treatments']);});
  financing.append(action('Remove ADU financing',()=>change(financePath,undefined)));
 }

}
