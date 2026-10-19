import type { Available,Cents,Property,RentalUnit,TaxBook } from '../../engine';
import { usesAduPlanningEstimates } from '../../engine/property/adu-planning-estimates';
import { aduAreaRatios,calculateAduValueAdded } from '../../engine/property/adu-valuation';
import type { PropertyDraftBundle } from '../adu-project-draft';
import { button,element,renderField,renderHistory,setAt,valueAt,type FieldContext,type FieldOptions,type FieldPath } from '../fields';
import { idFor } from '../record-ids';
import { fromDraftValue,type RawObject,type WorkspaceController } from '../state';
import { formatCents } from '../views/issues';
export const books:readonly [TaxBook,string][]=[['federal','Federal'],['california','California'],['federal-amt','Federal AMT'],['california-amt','California AMT']];
export const unknown=()=>({known:false});
export const unknownTreatments=():RawObject=>Object.fromEntries(books.map(([book])=>[book,unknown()]));
export const zeroSplit=()=>({buildingBasisCents:'0.00',currentDeductionCents:'0.00',nondepreciableBasisCents:'0.00',nondeductibleExpenseCents:'0.00'});
export function group(root:HTMLElement,title:string,optional=false):HTMLElement {const node=element(optional?'details':'fieldset');node.append(element(optional?'summary':'legend',title));if(optional){node.dataset.aduDisclosure=title;node.dataset.disclosureName=title;node.dataset.propertyDisclosure=`${root.closest<HTMLElement>('[data-adu-record-id]')?.dataset.aduRecordId??root.closest<HTMLElement>('[data-record-id]')?.dataset.recordId??'adu'}:${title}`;}root.append(node);return node;}
export function missing():Available<never>{return{status:'needs-data',issues:[]};}

export function createAduEnvironment(root:HTMLElement,controller:WorkspaceController,context:FieldContext){
 const path:FieldPath=['property','aduProject'],project=valueAt(context.draft.value,path) as RawObject;
 const get=(p:FieldPath):any=>valueAt(context.draft.value,p);
 const change=(p:FieldPath,v:unknown)=>{context.onChange(p,v);context.refresh();};
 const action=(label:string,fn:()=>void)=>button(label,()=>{if(!context.ui||root.isConnected)fn();});
 const field=(node:HTMLElement,p:FieldPath,label:string,options:FieldOptions={})=>renderField(node,context,p,label,{...options,refresh:true});
 const history=(node:HTMLElement,p:FieldPath,label:string,kind:'money'|'rate')=>renderHistory(node,context,p,label,{kind,refresh:true});
 const rows=(node:HTMLElement,p:FieldPath,title:string,add:string,remove:string,create:()=>RawObject,render:(node:HTMLElement,p:FieldPath)=>void)=>{
  for(const [i] of ((get(p)??[]) as readonly RawObject[]).entries()){const row=group(node,`${title} ${i+1}`);row.dataset.aduRecordId=String(get([...p,i,'id'])??get([...p,i,'year'])??title);render(row,[...p,i]);row.append(action(remove,()=>change(p,(get(p) as readonly RawObject[]).filter((_,j)=>j!==i))));}
  node.append(action(add,()=>change(p,[...(get(p)??[]),create()])));
 };
 const treatments=(node:HTMLElement,p:FieldPath)=>{
  for(const [book,label] of books){const bookPath=[...p,book],answer=get(bookPath),section=group(node,`${label} paid-amount treatment`,true);
   const adapted:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,bookPath,answer?.known?'known':'unknown')};},onChange(_p,v){change(bookPath,v==='known'?{known:true,value:zeroSplit()}:unknown());}};
   renderField(section,adapted,bookPath,`${label} treatment status`,{kind:'select',options:[{value:'unknown',label:'Unknown'},{value:'known',label:'Enter confirmed split'}]});
   if(answer?.known)for(const [key,name] of [['buildingBasisCents','Building basis'],['currentDeductionCents','Current deduction'],['nondepreciableBasisCents','Nondepreciable basis'],['nondeductibleExpenseCents','Nondeductible expense']] as const)field(section,[...bookPath,'value',key],`${label} ${name}`,{kind:'money'});
   section.append(element('small','Confirm the supported treatment independently for this book. The split must equal the paid amount; a building category does not confirm tax eligibility.'));
  }
 };
 const bundle=()=>context.draft.value as unknown as PropertyDraftBundle;
 const replaceBundle=(next:PropertyDraftBundle)=>context.onChange([],next);
 const nextId=(kind:string)=>idFor(controller,context,kind);
 // Read the home's reference independently of unfinished construction inputs.
 const decode=(raw:RawObject):RawObject|undefined=>{const parsed=fromDraftValue(raw,context.draft.recordId);return parsed.issues.length?undefined:parsed.value;};
 const primary=decode({primaryArea:get(['property','primaryArea'])}),aduArea=decode({aduArea:get(['property','aduArea'])}),homeValue=decode({openingValueCents:get(['property','openingValueCents'])});const core={...primary,...aduArea,...homeValue};
 const needsHomeArea=typeof primary?.primaryArea!=='number'||primary.primaryArea<=0;
 const showHomeArea=needsHomeArea||!!get([...path,'__draft','showHomeAreaInSetup']);
 const singleCost=(project.costs as RawObject[]).length===1;
 const rentalIndex=(get(['rentals']) as RawObject[]).findIndex(unit=>unit.id===project.rentalId);
 const valuationPath=[...path,'valuation'],v=get(valuationPath);
 const financePath=[...path,'financing'],loan=get(financePath);
 const detailedFinancing=()=>({id:nextId('adu-financing'),name:'ADU financing',aprBps:'',firstAmortizingPaymentMonth:`${Number(String(project.completionDate).slice(0,4))+1}-01`,termMonths:'360',collateralPropertyId:context.draft.recordId,draws:[],interestTaxRows:[],proceedsHistoryComplete:unknown(),rentalInterestQualified:unknown(),financingAtRiskQualification:unknown()});
 const simpleLoan=!!loan&&singleCost&&(loan.interestTaxRows as RawObject[]).length===0&&(loan.draws as RawObject[]).length===1&&((loan.draws as RawObject[])[0]!.costAllocations as RawObject[]).length===1&&((loan.draws as RawObject[])[0]!.costAllocations as RawObject[])[0]!.costId===(project.costs as RawObject[])[0]?.id;
 const ownedRental=rentalIndex>=0?get(['rentals',rentalIndex]):undefined;
 const modeInput=fromDraftValue({property:get(['property']),rental:ownedRental},context.draft.recordId).value;
 const planningEstimates=!!ownedRental&&usesAduPlanningEstimates(modeInput.property as unknown as Property,modeInput.rental as unknown as RentalUnit);
 const estimationPath=[...path,'taxEstimation'],estimation=get(estimationPath),taxMode=estimation?.mode??(planningEstimates?'simple':'detailed');
 const confirmedRate=get([...path,'propertyTax','marginalRateBps']),hasConfirmedRate=confirmedRate?.known===true;
 const rateOverrideHint='A confirmed property-tax rate overrides the planning default. Edit Marginal property-tax rate (%) in Assessed-value planning and paid property taxes.';
 const rawValue=decode({valuation:v}),property={...(controller.getState().savedPlan.properties.find(p=>p.id===context.draft.recordId)??{}),...core,primaryArea:primary?.primaryArea,aduArea:aduArea?.aduArea,id:context.draft.recordId,aduProject:{valuation:rawValue?.valuation}} as Property;
 const added=rawValue&&(v.kind==='value-added'||aduArea)?calculateAduValueAdded(property):missing();
 const reference=primary&&homeValue?aduAreaRatios({...property,aduProject:{...property.aduProject!,valuation:{kind:'value-added',valueAddedCents:0},costs:[]}},missing()).existingWholePropertyValuePerSquareFootCents:missing();
 const text=(node:HTMLElement,title:string,result:Available<Cents>,testid?:string)=>{const p=element('p');p.append(element('strong',`${title}: `),document.createTextNode(result.status==='available'?formatCents(result.value):'Needs valid inputs'));if(testid)p.dataset.testid=testid;node.append(p);};
 const completed=get([...path,'completionDate']);
 return {path,project,get,change,action,field,history,rows,treatments,bundle,replaceBundle,nextId,decode,primary,aduArea,homeValue,core,needsHomeArea,showHomeArea,singleCost,rentalIndex,valuationPath,v,financePath,loan,detailedFinancing,simpleLoan,ownedRental,modeInput,planningEstimates,estimationPath,estimation,taxMode,confirmedRate,hasConfirmedRate,rateOverrideHint,rawValue,property,added,reference,text,completed};
}
export function aduPanels(root:HTMLElement){return {setup:root.querySelector<HTMLElement>('[data-adu-setup]')!,advanced:root.querySelector<HTMLElement>('[data-adu-advanced]')!,main:root.querySelector<HTMLElement>('[data-adu-main]')!};}
