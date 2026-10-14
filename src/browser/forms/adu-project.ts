import type {AduProject,Available,Cents,Property,TaxBook} from '../../engine';
import {Decimal,settleCents} from '../../engine/money';
import {calculateAduValueAdded,aduAreaRatios} from '../../engine/property/adu-valuation';
import {estimateAduPropertyTax,planAduTaxPayment} from '../../engine/property/adu-property-tax';
import {button,element,renderField,renderBooleanHistory,renderHistory,setAt,valueAt,type FieldContext,type FieldOptions,type FieldPath} from '../fields';
import {fromDraftValue,toDraftValue,type RawObject,type WorkspaceController} from '../state';
import {idFor} from '../record-ids';
import {formatCents} from '../views/issues';
const books:readonly [TaxBook,string][]=[['federal','Federal'],['california','California'],['federal-amt','Federal AMT'],['california-amt','California AMT']];
const unknown=()=>({known:false});
const unknownTreatments=():RawObject=>Object.fromEntries(books.map(([book])=>[book,unknown()]));
const zeroSplit=()=>({buildingBasisCents:'0.00',currentDeductionCents:'0.00',nondepreciableBasisCents:'0.00',nondeductibleExpenseCents:'0.00'});
function group(root:HTMLElement,title:string,optional=false):HTMLElement {const node=element(optional?'details':'fieldset');node.append(element(optional?'summary':'legend',title));if(optional){node.dataset.aduDisclosure=title;node.dataset.propertyDisclosure=`${root.closest<HTMLElement>('[data-adu-record-id]')?.dataset.aduRecordId??root.closest<HTMLElement>('[data-record-id]')?.dataset.recordId??'adu'}:${title}`;}root.append(node);return node;}
function missing():Available<never>{return{status:'needs-data',issues:[]};}
export function renderAduProjectFields(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const path:FieldPath=['property','aduProject'],project=valueAt(context.draft.value,path) as RawObject;
 if(!project)return;
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
 const main=group(root,'ADU construction and completion');main.classList.add('adu-project');
 field(main,[...path,'name'],'ADU project name');field(main,[...path,'constructionStartDate'],'Construction start date',{kind:'date'});field(main,[...path,'completionDate'],'Construction completion date',{kind:'date'});
 field(main,['property','primaryArea'],'Primary home living area (sq ft)',{optional:true});field(main,['property','aduArea'],'ADU living area (sq ft)');
 const valuation=group(main,'Completion market-value assumption');
 const valuationPath=[...path,'valuation'],v=get(valuationPath);
 const valuationContext:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,[...valuationPath,'kind'],v.kind)};},onChange(_p,kind){change(valuationPath,kind==='value-added'?{kind,valueAddedCents:''}:{kind:'adu-value-per-square-foot',valuePerSquareFootCents:''});}};
 renderField(valuation,valuationContext,[...valuationPath,'kind'],'Completion value assumption',{kind:'select',options:[{value:'adu-value-per-square-foot',label:'Added value per ADU square foot'},{value:'value-added',label:'Direct completion value added'}]});
 if(v.kind==='value-added')field(valuation,[...valuationPath,'valueAddedCents'],'Assumed completion value added',{kind:'money'});else field(valuation,[...valuationPath,'valuePerSquareFootCents'],'Assumed added value per ADU sq ft',{kind:'money'});
 // Decode each math display's own inputs; other invalid rows cannot erase it.
 const decode=(raw:RawObject):RawObject|undefined=>{const parsed=fromDraftValue(raw,context.draft.recordId);return parsed.issues.length?undefined:parsed.value;};
 const primary=decode({primaryArea:get(['property','primaryArea'])}),aduArea=decode({aduArea:get(['property','aduArea'])}),homeValue=decode({openingValueCents:get(['property','openingValueCents'])});const core={...primary,...aduArea,...homeValue};
 const rawValue=decode({valuation:v}),property={...(controller.getState().savedPlan.properties.find(p=>p.id===context.draft.recordId)??{}),...core,primaryArea:primary?.primaryArea,aduArea:aduArea?.aduArea,id:context.draft.recordId,aduProject:{valuation:rawValue?.valuation}} as Property;
 const added=rawValue&&(v.kind==='value-added'||aduArea)?calculateAduValueAdded(property):missing();
 const reference=primary&&homeValue?aduAreaRatios({...property,aduProject:{...property.aduProject!,valuation:{kind:'value-added',valueAddedCents:0},costs:[]}},missing()).existingWholePropertyValuePerSquareFootCents:missing();
 const text=(node:HTMLElement,title:string,result:Available<Cents>,testid?:string)=>{const p=element('p');p.append(element('strong',`${title}: `),document.createTextNode(result.status==='available'?formatCents(result.value):'Needs valid inputs'));if(testid)p.dataset.testid=testid;node.append(p);};
 text(valuation,'Current whole-property value per sq ft, including land',reference);
 if(v.kind==='adu-value-per-square-foot'){const copy=action('Use this rate as an assumption',()=>{if(reference.status==='available')change([...valuationPath,'valuePerSquareFootCents'],toDraftValue(reference.value,'valuePerSquareFootCents'));});copy.disabled=reference.status!=='available';valuation.append(copy);}
 valuation.append(element('small','This reference includes the original home and land. Copying its rounded rate is an explicit assumption about ADU added value, not an appraisal.'));
 text(valuation,'Assumed completion value added',added,'adu-draft-value-added');
 const area=typeof core?.primaryArea==='number'&&typeof core?.aduArea==='number'?new Decimal(core.primaryArea).plus(core.aduArea).toString():'Needs valid areas';valuation.append(element('p',`Combined home and ADU living area: ${area} sq ft`));
 const costs=group(main,'Staged construction cash');rows(costs,[...path,'costs'],'Cost stage','Add cost stage','Remove cost stage',()=>({id:idFor(controller,context,'adu-stage'),name:'Cost stage',paymentDate:get([...path,'completionDate']),amountCents:'',category:'building',treatments:unknownTreatments()}),(row,p)=>{
  field(row,[...p,'name'],'Cost stage name');field(row,[...p,'paymentDate'],'Stage payment date',{kind:'date'});field(row,[...p,'amountCents'],'Stage amount',{kind:'money'});field(row,[...p,'category'],'Cost category',{kind:'select',options:['building','land','financing-fee','other']});treatments(row,[...p,'treatments']);
 });
 const enteredCosts=decode({costs:(project.costs as RawObject[]).map(c=>({amountCents:c.amountCents}))});let total:Available<Cents>=missing();try{if(enteredCosts)total={status:'available',value:settleCents((enteredCosts.costs as {amountCents:number}[]).reduce((s,c)=>s.plus(c.amountCents),new Decimal(0)))};}catch{/* Only this preview is outside the supported range. */}
 text(costs,'Planned construction cash',total,'adu-draft-construction-total');
 if(total.status==='available'&&core?.aduArea&&typeof core.aduArea==='number')try{text(costs,'Construction cash per ADU sq ft',{status:'available',value:settleCents(new Decimal(total.value).div(core.aduArea))});}catch{/* Independent preview remains unavailable. */}
 const completed=get([...path,'completionDate']);const paid=(project.costs as RawObject[]).filter(c=>typeof c.paymentDate==='string'&&c.paymentDate<`${controller.getState().savedPlan.startYear}-01-01`);const paidRaw=decode({costs:paid.map(c=>({amountCents:c.amountCents}))});if(paidRaw)try{text(costs,'Paid by forecast opening',{status:'available',value:settleCents((paidRaw.costs as {amountCents:number}[]).reduce((s,c)=>s.plus(c.amountCents),new Decimal(0)))});}catch{}
 if(total.status==='available')text(costs,'Future construction commitments',total);
 const financing=group(main,'Dedicated ADU financing',true),financePath=[...path,'financing'],loan=get(financePath);
 if(!loan)financing.append(element('p','Cash-funded construction; no loan receipts are planned.'),action('Add ADU financing',()=>change(financePath,{id:idFor(controller,context,'adu-financing'),name:'ADU financing',aprBps:'',firstAmortizingPaymentMonth:`${Number(String(completed).slice(0,4))+1}-01`,termMonths:'360',collateralPropertyId:context.draft.recordId,draws:[],interestTaxRows:[],proceedsHistoryComplete:unknown(),rentalInterestQualified:unknown(),financingAtRiskQualification:unknown()})));
 else{
  field(financing,[...financePath,'name'],'ADU financing name');field(financing,[...financePath,'aprBps'],'ADU financing APR (%)',{kind:'rate'});field(financing,[...financePath,'firstAmortizingPaymentMonth'],'First amortizing payment month',{kind:'month'});field(financing,[...financePath,'termMonths'],'ADU financing term (months)',{kind:'integer'});
  rows(financing,[...financePath,'draws'],'Financing draw','Add financing draw','Remove financing draw',()=>({id:idFor(controller,context,'adu-draw'),month:String(get([...path,'constructionStartDate'])).slice(0,7),amountCents:'',costAllocations:[{costId:(get([...path,'costs']) as RawObject[])[0]?.id??'',amountCents:''}]}),(row,p)=>{
   field(row,[...p,'month'],'Draw month',{kind:'month'});field(row,[...p,'amountCents'],'Draw amount',{kind:'money'});
   rows(row,[...p,'costAllocations'],'Draw attribution','Add funded cost','Remove funded cost',()=>({costId:(get([...path,'costs']) as RawObject[])[0]?.id??'',amountCents:''}),(allocation,a)=>{field(allocation,[...a,'costId'],'Funded cost stage',{kind:'select',options:(get([...path,'costs']) as RawObject[]).map(c=>({value:String(c.id),label:String(c.name)}))});field(allocation,[...a,'amountCents'],'Draw amount attributed to stage',{kind:'money'});});
  });
  const tax=group(financing,'Interest tracing and construction treatment',true);for(const [key,label] of [['proceedsHistoryComplete','ADU proceeds tracing complete'],['rentalInterestQualified','ADU rental interest qualified'],['financingAtRiskQualification','ADU borrowing qualifies as amount at risk']] as const)renderBooleanHistory(tax,context,[...financePath,key],label);
  rows(tax,[...financePath,'interestTaxRows'],'Monthly interest treatment','Add interest tax row','Remove interest tax row',()=>({id:idFor(controller,context,'adu-interest'),month:String(completed).slice(0,7),treatments:unknownTreatments()}),(row,p)=>{field(row,[...p,'month'],'Interest treatment month',{kind:'month'});treatments(row,[...p,'treatments']);});
  financing.append(action('Remove ADU financing',()=>change(financePath,undefined)));
 }
 const taxes=group(main,'Assessed-value planning and paid property taxes',true),taxPath=[...path,'propertyTax'];
 history(taxes,[...taxPath,'addedAssessedValueCents'],'Added assessed value','money');history(taxes,[...taxPath,'marginalRateBps'],'Marginal property-tax rate (%)','rate');field(taxes,[...taxPath,'annualAssessmentGrowthBps'],'Annual added-assessment growth (%)',{kind:'rate'});field(taxes,[...taxPath,'completedValueEnrollmentYear'],'Completed assessment enrollment year',{kind:'integer'});field(taxes,[...taxPath,'additionalAnnualChargesCents'],'Additional annual ADU charges',{kind:'money'});
 renderBooleanHistory(taxes,context,[...taxPath,'originalExpenseExcludesAdu'],'Original property-tax expenses exclude ADU payments');
 rows(taxes,[...taxPath,'constructionAssessments'],'January 1 progress assessment','Add progress assessment','Remove progress assessment',()=>({year:String(controller.getState().savedPlan.startYear),valueCents:unknown()}),(row,p)=>{field(row,[...p,'year'],'Progress assessment year',{kind:'integer'});history(row,[...p,'valueCents'],'January 1 assessed progress value','money');});
 const taxInput=decode({propertyTax:get(taxPath)});
 for(let year=controller.getState().savedPlan.startYear;year<controller.getState().savedPlan.startYear+controller.getState().savedPlan.horizonYears;year++){
  const estimate=taxInput?estimateAduPropertyTax({...property,aduProject:{...property.aduProject!,constructionStartDate:String(project.constructionStartDate),completionDate:String(project.completionDate),propertyTax:taxInput.propertyTax as AduProject['propertyTax']}},year):missing();
  const estimatedCash:Available<Cents>=estimate.status==='available'?{status:'available',value:estimate.value.recurringAnnualTaxCents}:estimate;
  text(taxes,`Estimated regular assessed tax for ${year}`,estimatedCash);
  const copy=action(`Plan estimated regular payment for ${year}`,()=>{if(estimate.status!=='available')return;const payment=toDraftValue(planAduTaxPayment(property,year,`${year}-12`,'regular',estimate.value.recurringAnnualTaxCents,idFor(controller,context,'adu-tax-payment')));
   const years=get([...taxPath,'paymentYears']) as RawObject[],existing=years.findIndex(y=>String(y.year)===String(year));change([...taxPath,'paymentYears'],existing>=0?years.map((y,i)=>i===existing?{...y,payments:[...(y.payments as RawObject[]),payment]}:y):[...years,{year:String(year),complete:unknown(),payments:[payment]}]);
  });copy.disabled=estimate.status!=='available';taxes.append(copy);
 }
 rows(taxes,[...taxPath,'paymentYears'],'Paid-tax year','Add paid-tax year','Remove paid-tax year',()=>({year:String(controller.getState().savedPlan.startYear),complete:unknown(),payments:[]}),(row,p)=>{
  field(row,[...p,'year'],'Paid-tax calendar year',{kind:'integer'});renderBooleanHistory(row,context,[...p,'complete'],'Incremental paid-tax schedule complete (including zero)');
  rows(row,[...p,'payments'],'Planned tax payment','Add planned tax payment','Remove planned tax payment',()=>({id:idFor(controller,context,'adu-tax-payment'),month:`${get([...p,'year'])}-12`,amountCents:'',kind:'regular',treatments:unknownTreatments()}),(payment,q)=>{field(payment,[...q,'month'],'Tax payment month',{kind:'month'});field(payment,[...q,'amountCents'],'Incremental tax payment amount',{kind:'money'});field(payment,[...q,'kind'],'Tax payment kind',{kind:'select',options:['regular','supplemental','construction-in-progress']});treatments(payment,[...q,'treatments']);});
 });taxes.append(element('small','Assessed-value estimates are separate from payment timing. Enter regular, supplemental and progress payments explicitly; the estimator never invents a supplemental bill or confirms a complete year.'));
 const shared=group(main,'Prospective original-expense sharing',true);rows(shared,[...path,'sharedExpenseOverrides'],'Original-expense override','Add prospective shared expense','Remove prospective shared expense',()=>({id:idFor(controller,context,'adu-override'),expenseId:(get(['expenses']) as RawObject[]).find(e=>!e.rentalId)?.id??''}),(row,p)=>{
  field(row,[...p,'expenseId'],'Original expense to share after readiness',{kind:'select',options:(get(['expenses']) as RawObject[]).filter(e=>!e.rentalId).map(e=>({value:String(e.id),label:String(e.name)}))});
  const sharePath=[...p,'share'],explicit=!!get(sharePath),adapted:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,sharePath,explicit?'explicit':'area')};},onChange(_p,v){change(sharePath,v==='explicit'?{numerator:'',denominator:''}:undefined);}};
  renderField(row,adapted,sharePath,'Prospective allocation share',{kind:'select',options:[{value:'area',label:'Area share after readiness'},{value:'explicit',label:'Explicit share after readiness'}]});if(explicit){field(row,[...sharePath,'numerator'],'ADU rental portions',{kind:'integer'});field(row,[...sharePath,'denominator'],'Total allocation portions',{kind:'integer'});}
 });
 const qualifications=group(main,'Project tax qualifications and building recovery',true);
 for(const [book,label] of books){renderBooleanHistory(qualifications,context,[...path,'taxQualifications',book],`${label} ordinary project tax treatment qualified`);const costs=get([...path,'costs']) as RawObject[],splits=costs.map(c=>(c.treatments as RawObject)?.[book] as {known?:boolean;value?:RawObject});const parsed=splits.every(s=>s?.known)?decode({costs:splits.map(s=>s.value)}):undefined;let basis:Available<Cents>=missing();if(parsed)try{basis={status:'available',value:settleCents((parsed.costs as {buildingBasisCents:number}[]).reduce((s,c)=>s.plus(c.buildingBasisCents),new Decimal(0)))};}catch{}text(qualifications,`${label} confirmed staged building basis`,basis);}
 renderBooleanHistory(qualifications,context,[...path,'supportOperatingDeficits'],'Owner supports monthly ADU operating deficits including principal');
 const periodPath=[...path,'productionPeriod'],period=get(periodPath),adapted:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,periodPath,period.known?'known':'unknown')};},onChange(_p,v){change(periodPath,v==='known'?{known:true,value:{startDate:'',endDate:'',uninterrupted:false}}:unknown());}};
 renderField(qualifications,adapted,periodPath,'Physical production period status',{kind:'select',options:[{value:'unknown',label:'Unknown'},{value:'known',label:'Enter confirmed period'}]});if(period.known){field(qualifications,[...periodPath,'value','startDate'],'Physical production start date',{kind:'date'});field(qualifications,[...periodPath,'value','endDate'],'Physical production end date',{kind:'date'});field(qualifications,[...periodPath,'value','uninterrupted'],'Uninterrupted physical production',{kind:'checkbox'});}
 for(const detail of main.querySelectorAll<HTMLDetailsElement>('details[data-property-disclosure]'))detail.open=context.ui?.editorView?.propertyDisclosures.get(detail.dataset.propertyDisclosure!)??false;
 qualifications.append(element('small','Building recovery starts when ready and available for rent, using 27.5-year cumulative mid-month depreciation. Paid cost, completion market value, building basis and assessed value are separate quantities. Loan fees, later improvements and interrupted production need separate recovery support.'));
}
