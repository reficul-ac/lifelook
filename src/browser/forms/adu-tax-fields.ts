import type { AduProject,Available,Cents } from '../../engine';
import { Decimal,settleCents } from '../../engine/money';
import { estimateAduPropertyTax,planAduTaxPayment } from '../../engine/property/adu-property-tax';
import { element,renderBooleanHistory,renderField,setAt,type FieldContext } from '../fields';
import { idFor } from '../record-ids';
import { fieldMemory,swapMode } from '../record-ui-state';
import { toDraftValue,type RawObject,type WorkspaceController } from '../state';
import { aduPanels,books,createAduEnvironment,group,missing,unknown,unknownTreatments } from './adu-fields-shared';

export function renderAduTaxFields(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
 const {path,project,get,change,action,field,history,rows,treatments,decode,ownedRental,planningEstimates,estimationPath,estimation,taxMode,confirmedRate,hasConfirmedRate,rateOverrideHint,property,text}=createAduEnvironment(root,controller,context);
 const {setup,main}=aduPanels(root);
 if(planningEstimates){
  const rate=decode({propertyTaxRateBps:hasConfirmedRate?confirmedRate.value:estimation?.propertyTaxRateBps??'1.20'}),rateLabel=typeof rate?.propertyTaxRateBps==='number'&&rate.propertyTaxRateBps>=0?`${new Decimal(rate.propertyTaxRateBps).div(100).toString()}%`:'the entered rate';
  setup.append(element('p',`Planning tax estimates use ordinary residential rental treatment, depreciation of building construction costs, and estimated ${rateLabel} added property tax. Edit these assumptions in Advanced ADU details; confirmed inputs override estimates.`));
  if(hasConfirmedRate)setup.append(element('small',rateOverrideHint));
 }else setup.append(element('p','Detailed tax calculation uses entered treatments and qualifications. Missing tax answers leave dependent results marked Needs data.'));
 if(ownedRental)setup.append(element('small',`Rent is planned from ${String(ownedRental.rentStartDate)}. Adjust timing, payment schedules and tax assumptions in Advanced ADU details.`));
 const calculation=group(main,'Tax calculation assumptions');
 const modeContext:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,[...estimationPath,'mode'],taxMode)};},onChange(_p,mode){change(estimationPath,swapMode(fieldMemory(context),'adu-tax',String(taxMode),String(mode),estimation??{mode:taxMode},mode==='simple'?{mode:'simple',propertyTaxRateBps:'1.20'}:{mode:'detailed'}));}};
 renderField(calculation,modeContext,[...estimationPath,'mode'],'ADU tax calculation',{kind:'select',options:[{value:'simple',label:'Planning estimates'},{value:'detailed',label:'Detailed tax inputs'}]});
 if(taxMode==='simple'){
  const rateContext:FieldContext={...context,get draft(){return{...context.draft,value:setAt(context.draft.value,[...estimationPath,'propertyTaxRateBps'],estimation?.propertyTaxRateBps??'1.20')};},onChange(_p,value){context.onChange(estimationPath,{mode:'simple',propertyTaxRateBps:value});}};
  const rateControl=renderField(calculation,rateContext,[...estimationPath,'propertyTaxRateBps'],'Estimated ADU property-tax rate (%)',{kind:'rate',refresh:true,...(hasConfirmedRate?{hint:rateOverrideHint}:{})});rateControl.disabled=hasConfirmedRate;
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
 const paymentYears=group(taxes,'Paid-tax years');paymentYears.dataset.fieldGroup=[...taxPath,'paymentYears'].join('.');paymentYears.dataset.groupLabel='Paid-tax years';
 rows(paymentYears,[...taxPath,'paymentYears'],'Paid-tax year','Add paid-tax year','Remove paid-tax year',()=>({year:String(controller.getState().savedPlan.startYear),complete:unknown(),payments:[]}),(row,p)=>{
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
 qualifications.append(element('small','Building recovery starts when ready and available for rent, using 27.5-year cumulative mid-month depreciation. Paid cost, completion market value, building basis and assessed value are separate quantities. Loan fees, later improvements and interrupted production need separate recovery support.'));

}
