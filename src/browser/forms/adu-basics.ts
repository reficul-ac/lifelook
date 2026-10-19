import type { AduProject,Available,Cents } from '../../engine';
import { Decimal,settleCents } from '../../engine/money';
import { setAduCompletionDate } from '../adu-project-setup';
import { element,renderField,setAt,type FieldContext } from '../fields';
import { idFor } from '../record-ids';
import { fieldMemory,swapMode } from '../record-ui-state';
import { toDraftValue,type RawObject,type WorkspaceController } from '../state';
import { createAduEnvironment,group,missing,unknownTreatments } from './adu-fields-shared';

export function renderAduBasics(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const {path,project,get,change,action,field,rows,treatments,bundle,replaceBundle,decode,core,needsHomeArea,showHomeArea,singleCost,rentalIndex,valuationPath,v,rawValue,added,reference,text}=createAduEnvironment(root,controller,context);
 const setup=group(root,'ADU setup');setup.classList.add('adu-project','adu-setup-fields');setup.dataset.aduSetup='';
 setup.append(element('p','Enter your project estimates below.'));
 field(setup,['property','aduArea'],'ADU living area (sq ft)');
 if(showHomeArea){
  const areaContext:FieldContext={...context,onChange(p,value){const next=setAt(setAt(context.draft.value,p,value),[...path,'__draft','showHomeAreaInSetup'],true);context.onChange([],next);}};
  renderField(setup,areaContext,['property','primaryArea'],'Primary home living area (sq ft)',{optional:true,refresh:true});
 }
 if(singleCost)field(setup,[...path,'costs',0,'amountCents'],'Total ADU build cost',{kind:'money'});
 const completionContext:FieldContext={...context,onChange(_p,value){replaceBundle(setAduCompletionDate(bundle(),String(value)));}};
 renderField(setup,completionContext,[...path,'completionDate'],'Construction completion date',{kind:'date',refresh:true});
 if(rentalIndex>=0)field(setup,['rentals',rentalIndex,'monthlyRentCents'],'Monthly rent receipts',{kind:'money'});
 if(v.kind==='value-added')field(setup,[...valuationPath,'valueAddedCents'],'Assumed completion value added',{kind:'money',hint:'Added market value is an estimate, separate from what you spend to build.'});
 const advanced=group(root,'Advanced ADU details',true);advanced.dataset.fieldGroup='property.aduProject';advanced.dataset.aduAdvanced='';
 const main=group(advanced,'ADU construction and completion');main.dataset.aduMain='';
 field(main,[...path,'name'],'ADU project name');field(main,[...path,'constructionStartDate'],'Construction start date',{kind:'date'});
 if(!showHomeArea)field(main,['property','primaryArea'],'Primary home living area (sq ft)',{optional:true});
 const valuation=group(main,'Completion market-value assumption');
 const valuationContext:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,[...valuationPath,'kind'],v.kind)};},onChange(_p,kind){change(valuationPath,swapMode(fieldMemory(context),'adu-valuation',String(v.kind),String(kind),v,kind==='value-added'?{kind,valueAddedCents:''}:{kind:'adu-value-per-square-foot',valuePerSquareFootCents:''}));}};
 renderField(valuation,valuationContext,[...valuationPath,'kind'],'Completion value assumption',{kind:'select',options:[{value:'adu-value-per-square-foot',label:'Added value per ADU square foot'},{value:'value-added',label:'Direct completion value added'}]});
 if(v.kind!=='value-added')field(valuation,[...valuationPath,'valuePerSquareFootCents'],'Assumed added value per ADU sq ft',{kind:'money'});
 // Decode each math display's own inputs; other invalid rows cannot erase it.
 text(setup,'Current home value per sq ft, including land',reference);
 const useHomeRate=action('Use current home value per sq ft',()=>{if(reference.status==='available')change(valuationPath,{kind:'adu-value-per-square-foot',valuePerSquareFootCents:toDraftValue(reference.value,'valuePerSquareFootCents')});});useHomeRate.disabled=reference.status!=='available';setup.append(useHomeRate);
 if(needsHomeArea)setup.append(element('small','Enter a positive primary home living area to use the current home value per sq ft.'));
 else if(reference.status!=='available')setup.append(element('small','Enter a valid original home market value in Existing home details to use its value per sq ft.'));
 text(valuation,'Current whole-property value per sq ft, including land',reference);
 if(v.kind==='adu-value-per-square-foot'){const copy=action('Use this rate as an assumption',()=>{if(reference.status==='available')change([...valuationPath,'valuePerSquareFootCents'],toDraftValue(reference.value,'valuePerSquareFootCents'));});copy.disabled=reference.status!=='available';valuation.append(copy);}
 valuation.append(element('small','This reference includes the original home and land. Copying its rounded rate is an explicit assumption about ADU added value, not an appraisal.'));
 text(valuation,'Assumed completion value added',added,'adu-draft-value-added');
 if(v.kind!=='value-added'){
  const rate=rawValue?.valuation as AduProject['valuation']|undefined;
  text(setup,'Assumed added value per ADU sq ft',rate?.kind==='adu-value-per-square-foot'?{status:'available',value:rate.valuePerSquareFootCents}:missing());
  text(setup,'Assumed completion value added',added);
  setup.append(action('Enter added home value directly',()=>change(valuationPath,{kind:'value-added',valueAddedCents:added.status==='available'?toDraftValue(added.value,'valueAddedCents'):''})));
 }
 const area=typeof core?.primaryArea==='number'&&typeof core?.aduArea==='number'?new Decimal(core.primaryArea).plus(core.aduArea).toString():'Needs valid areas';valuation.append(element('p',`Combined home and ADU living area: ${area} sq ft`));
 const costs=group(main,'Staged construction cash');rows(costs,[...path,'costs'],'Cost stage','Add cost stage','Remove cost stage',()=>({id:idFor(controller,context,'adu-stage'),name:'Cost stage',paymentDate:get([...path,'completionDate']),amountCents:'',category:'building',treatments:unknownTreatments()}),(row,p)=>{
  field(row,[...p,'name'],'Cost stage name');field(row,[...p,'paymentDate'],'Stage payment date',{kind:'date'});if(!singleCost)field(row,[...p,'amountCents'],'Stage amount',{kind:'money'});field(row,[...p,'category'],'Cost category',{kind:'select',options:['building','land','financing-fee','other']});treatments(row,[...p,'treatments']);
 });
 const enteredCosts=decode({costs:(project.costs as RawObject[]).map(c=>({amountCents:c.amountCents}))});let total:Available<Cents>=missing();try{if(enteredCosts)total={status:'available',value:settleCents((enteredCosts.costs as {amountCents:number}[]).reduce((s,c)=>s.plus(c.amountCents),new Decimal(0)))};}catch{/* Only this preview is outside the supported range. */}
 text(costs,'Planned construction cash',total,'adu-draft-construction-total');
 if(!singleCost){text(setup,'Total ADU build cost',total);setup.append(element('small','This project has multiple payments. Edit its payment schedule in Advanced ADU details.'));}
 if(total.status==='available'&&core?.aduArea&&typeof core.aduArea==='number')try{text(costs,'Construction cash per ADU sq ft',{status:'available',value:settleCents(new Decimal(total.value).div(core.aduArea))});}catch{/* Independent preview remains unavailable. */}
 const paid=(project.costs as RawObject[]).filter(c=>typeof c.paymentDate==='string'&&c.paymentDate<`${controller.getState().savedPlan.startYear}-01-01`);const paidRaw=decode({costs:paid.map(c=>({amountCents:c.amountCents}))});if(paidRaw)try{text(costs,'Paid by forecast opening',{status:'available',value:settleCents((paidRaw.costs as {amountCents:number}[]).reduce((s,c)=>s.plus(c.amountCents),new Decimal(0)))});}catch{}
 if(total.status==='available')text(costs,'Future construction commitments',total);

}
