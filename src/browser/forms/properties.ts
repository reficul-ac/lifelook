import {calculateLoanSchedule} from '../../engine/property/loans';
import type {PropertyLoan} from '../../engine';
import type {IssueViewContext} from '../issue-presentation';
import {syncFormFeedback,setFormTaskIssues,registerFormSummary} from '../form-feedback';
import { defaultRentalAllocation,initializePurchaseLoan,type Property,type RentalUnit,type TaxBook,type PurchaseLoanInput } from '../../engine';
import { button,element,refreshFields,renderField,renderBooleanHistory,setAt,valueAt,type FieldContext,type FieldPath,type FieldOptions,taxCategoryOptions } from '../fields';
import { fromDraftValue,toDraftValue,type RawObject,type WorkspaceController } from '../state';

const books:readonly [TaxBook,string][]=[['federal','Federal rental tax history'],['california','California rental tax history'],['federal-amt','Federal AMT rental tax history'],['california-amt','California AMT rental tax history']];
const bookAmounts:readonly [string,string][]=[['recoveryBasisCents','Original building recovery basis (excludes land)'],['adjustedBuildingBasisCents','Adjusted building basis'],['cumulativeDepreciationCents','Prior depreciation'],['atRiskCents','Opening amount at risk'],['atRiskSuspendedCents','Suspended at-risk losses'],['passiveSuspendedCents','Suspended passive losses']];
const zeroBook={recoveryBasisCents:0,adjustedBuildingBasisCents:0,cumulativeDepreciationCents:0,atRiskCents:0,atRiskSuspendedCents:0,passiveSuspendedCents:0,lossVintages:[]};
const unknown=()=>({known:false});
function group(root:HTMLElement,name:string):HTMLFieldSetElement {const node=element('fieldset');node.append(element('legend',name));root.append(node);return node;}
interface PropertyDisclosureOptions {readonly key:string;readonly initialOpen?:boolean;readonly status?:string}
const disclosureStates=new WeakMap<HTMLElement,Map<string,boolean>>(),disclosureRoots=new WeakMap<HTMLElement,HTMLElement>();
function ownerFor(node:HTMLElement):HTMLElement {for(let parent:HTMLElement|null=node;parent;parent=parent.parentElement){const owner=disclosureRoots.get(parent);if(owner)return owner;}return node;}
function captureDisclosures(root:HTMLElement):void {const owner=ownerFor(root),state=disclosureStates.get(owner)??new Map<string,boolean>();for(const node of root.querySelectorAll<HTMLDetailsElement>('details[data-property-disclosure]'))state.set(node.dataset.propertyDisclosure!,node.open);disclosureStates.set(owner,state);}
function details(root:HTMLElement,name:string,options:PropertyDisclosureOptions):HTMLDetailsElement {
  const owner=ownerFor(root),state=disclosureStates.get(owner)??new Map<string,boolean>();disclosureStates.set(owner,state);
  const node=element('details');node.dataset.propertyDisclosure=options.key;node.dataset.disclosureName=name;node.dataset.disclosureStatus=options.status??'';node.open=state.get(options.key)??options.initialOpen??false;state.set(options.key,node.open);disclosureRoots.set(node,owner);
  node.append(element('summary',name+(options.status?' · '+options.status:'')));node.addEventListener('toggle',()=>{if(node.isConnected)state.set(options.key,node.open);});root.append(node);return node;
}
function unknownCount(value:unknown):number {if(!value||typeof value!=='object')return 0;if('known' in value)return value.known?0:1;return Object.values(value).reduce<number>((count,item)=>count+unknownCount(item),0);}

function at(context:FieldContext,path:FieldPath):any{return valueAt(context.draft.value,path);}
function field(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,options:FieldOptions={}):void {renderField(root,context,path,label,options);}
function displayed(context:FieldContext,path:FieldPath,value:unknown,change:(value:unknown)=>void):FieldContext {
  return {...(context.ui?{ui:context.ui}:{}),get draft(){return {...context.draft,value:setAt(context.draft.value,path,value)};},get issues(){return context.issues;},onChange(_path,value){change(value);},refresh(){context.refresh();}};
}
function booleanHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string):void {
  const help:Record<string,string>={'Active participation':'Participation in rental management decisions is independent of floor area or ownership share.','Qualified acquisition debt':'Loan proceeds must qualify as acquisition debt under the applicable mortgage-interest rules.','QBI qualification':'Qualified business income eligibility depends on rental business facts; it is independent of cash flow.'};renderBooleanHistory(root,context,path,label,help[label]?{help:help[label]}:{});
}
function moneyHistory(root:HTMLElement,context:FieldContext,path:FieldPath,label:string,estimate=false):void {
  const history=at(context,path) as {known?:boolean;value?:string}|undefined;
  field(root,displayed(context,path,history?.known?'known':'unknown',value=>{context.onChange(path,value==='known'?{known:true,value:''}:unknown());context.refresh();}),path,`${label} history`,{kind:'select',options:[{value:'unknown',label:estimate?'Use schedule estimate':'Unknown'},{value:'known',label:estimate?'Enter known value':'Enter value'}]});
  if(history?.known)field(root,context,[...path,'value'],label,{kind:'money'});
}
function rows(root:HTMLElement,context:FieldContext,path:FieldPath,legend:string,addLabel:string,removeLabel:string,create:()=>RawObject,render:(root:HTMLElement,path:FieldPath,index:number)=>void):void {
  const values=at(context,path) as readonly RawObject[]|undefined;
  for(const [index] of (values??[]).entries()){
    const row=group(root,`${legend} ${index+1}`);render(row,[...path,index],index);
    row.append(button(removeLabel,()=>{context.onChange(path,(at(context,path) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));
  }
  root.append(button(addLabel,()=>{context.onChange(path,[...((at(context,path) as readonly RawObject[])??[]),create()]);context.refresh();}));
}
function idFor(controller:WorkspaceController,context:FieldContext,kind:string):string {
  const used=new Set<string>();function inspect(value:unknown):void {if(value&&typeof value==='object'){if('id' in value&&typeof value.id==='string')used.add(value.id);Object.values(value).forEach(inspect);}}
  inspect(controller.getState().savedPlan);inspect(controller.getState().drafts);inspect(context.draft.value);
  let number=1;while(used.has(`${context.draft.recordId}-${kind}-${number}`))number++;
  return `${context.draft.recordId}-${kind}-${number}`;
}
interface Choice {readonly value:string;readonly label:string}
interface NamedProperty {readonly id:string;readonly name:string;readonly role:string;readonly loans:readonly {id:string;name:string}[]}
function propertyRecords(controller:WorkspaceController,context:FieldContext):readonly NamedProperty[] {
  return [...controller.getState().savedPlan.properties.filter(p=>p.id!==context.draft.recordId),at(context,['property']) as NamedProperty];
}
function propertyOptions(controller:WorkspaceController,context:FieldContext):readonly Choice[] {
  return propertyRecords(controller,context).map(p=>({value:p.id,label:p.name||'Current property'}));
}
function rentalOptions(controller:WorkspaceController,context:FieldContext,propertyId?:string):readonly Choice[] {
  return propertyRecords(controller,context).filter(p=>!propertyId||p.id===propertyId).flatMap(property=>{
    const units=property.id===context.draft.recordId?at(context,['rentals']) as readonly {id:string}[]:controller.getState().savedPlan.rentals.filter(r=>r.propertyId===property.id);
    const kind=property.role==='primary-with-adu'?'ADU':property.role==='rental'?'Whole rental':'Rental unit';
    return units.map((unit,index)=>({value:unit.id,label:`${kind} ${index+1} — ${property.name||'Current property'}`}));
  });
}
function loanOptions(controller:WorkspaceController,context:FieldContext):readonly Choice[] {
  return propertyRecords(controller,context).flatMap(property=>property.loans.map((loan,index)=>({value:loan.id,label:`${loan.name||`Loan ${index+1}`} — ${property.name||'Current property'}`})));
}
function historyBook(root:HTMLElement,context:FieldContext,path:FieldPath,name:string):void {
  const history=at(context,path) as {known?:boolean;value?:RawObject}|undefined;
  const isZero=history?.known&&bookAmounts.every(([key])=>history.value?.[key]==='0.00')&&Array.isArray(history.value?.lossVintages)&&history.value.lossVintages.length===0;
  const shortName=name.replace(' rental tax history',' history'),owner=at(context,path.slice(0,-2)) as RawObject;const disclosure=details(root,shortName,{key:`${String(owner.id)}:${String(path[path.length-1])}`,status:!history?.known?'Unknown':isZero?'Confirmed zero':'Entered amounts'});disclosure.dataset.fieldGroup=path.join('.');registerFormSummary(disclosure,()=>{const current=at(context,path) as {known?:boolean;value?:RawObject}|undefined;return !current?.known?'Unknown':bookAmounts.every(([key])=>/^0(?:\.0{1,2})?$/.test(String(current.value?.[key]??'')))&&Array.isArray(current.value?.lossVintages)&&current.value.lossVintages.length===0?'Confirmed zero':'Entered amounts';});const section=group(disclosure,'Opening amounts');
  field(section,displayed(context,path,history?.known?isZero?'known-zero':'known':'unknown',value=>{
    context.onChange(path,value==='unknown'?unknown():{known:true,value:value==='known-zero'?toDraftValue(zeroBook):Object.fromEntries([...bookAmounts.map(([key])=>[key,'']),['lossVintages',[]]])});context.refresh();
  }),path,'History status',{kind:'select',options:[{value:'unknown',label:'Unknown'},{value:'known',label:'Enter amounts'},{value:'known-zero',label:'All amounts and losses are zero'}]});
  if(!history?.known)return;
  for(const [key,label]of bookAmounts)field(section,context,[...path,'value',key],label,{kind:'money'});
  rows(section,context,[...path,'value','lossVintages'],'Rental loss vintage','Add rental loss vintage','Remove rental loss vintage',()=>({year:'',source:'passive',amountCents:'',activeParticipation:unknown(),qbiQualification:unknown()}),(row,p)=>{
    field(row,context,[...p,'year'],'Loss year',{kind:'integer'});field(row,context,[...p,'source'],'Loss source',{kind:'select',options:[{value:'at-risk',label:'At-risk'},{value:'passive',label:'Passive'}]});field(row,context,[...p,'amountCents'],'Loss amount',{kind:'money'});
    booleanHistory(row,context,[...p,'activeParticipation'],'Participation when loss arose');booleanHistory(row,context,[...p,'qbiQualification'],'QBI qualification when loss arose');
  });
}
function allocationFields(root:HTMLElement,context:FieldContext,path:FieldPath):void {
  field(root,context,[...path,'numerator'],'Rental portion',{kind:'integer'});field(root,context,[...path,'denominator'],'Total portions',{kind:'integer',hint:'1 of 4 = 25%.'});
}
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
  const loan=at(context,path) as RawObject,saved=controller.getState().projection.loanSchedules.find(s=>s.loanId===loan.id&&s.year===controller.getState().savedPlan.startYear);const status=loanStatus(context,controller,path);const disclosure=details(root,`Loan — ${String(loan.name??loan.id)}`,{key:`${String(loan.id)}:loan`,initialOpen:!controller.getState().savedPlan.properties.some(p=>p.loans.some(l=>l.id===loan.id)),status});disclosure.dataset.fieldGroup=path.join('.');registerFormSummary(disclosure,()=>loanStatus(context,controller,path));const node=group(disclosure,'Loan terms');
  field(node,context,[...path,'name'],'Loan name');field(node,context,[...path,'originalPrincipalCents'],'Original principal',{kind:'money'});field(node,context,[...path,'aprBps'],'Nominal APR (%)',{kind:'rate'});
  for(const [key,label]of [['originationDate','Origination date'],['acquisitionDate','Acquisition date'],['firstPaymentDate','First payment date']] as const)field(node,context,[...path,key],label,{kind:'date'});
  field(node,context,[...path,'termMonths'],'Term (months)',{kind:'integer'});field(node,context,[...path,'collateralPropertyId'],'Collateral property',{kind:'select',options:propertyOptions(controller,context)});
  moneyHistory(node,context,[...path,'openingBalance'],'Opening mortgage balance',true);moneyHistory(node,context,[...path,'openingPayment'],'Opening principal-and-interest payment',true);
  node.append(element('p','Exclude property tax and insurance from loan payments.'));
  if(saved?.schedule.status==='available')node.append(element('p',`Saved opening balance: ${saved.schedule.value.openingProvenance}; saved payment: ${saved.schedule.value.paymentProvenance}. Exclude property tax and insurance.`));
  field(node,context,[...path,'proceedsQualification','kind'],'Proceeds type',{kind:'select',options:[{value:'acquisition',label:'Purchase/acquisition'},{value:'refinance',label:'Refinance'},{value:'cash-out',label:'Cash-out'},{value:'mixed',label:'Mixed proceeds'},{value:'grandfathered',label:'Grandfathered debt'},{value:'unknown',label:'Unknown'}],refresh:true});
  if(at(context,[...path,'proceedsQualification','kind'])==='acquisition')node.append(button('Calculate purchase loan',()=>{
    const current=at(context,path) as RawObject,result=purchaseTerms(context,current);
    if(result.status!=='available'){const form=node.closest<HTMLElement>('form')!;setFormTaskIssues(form,result.issues.map(issue=>({...issue,recordId:String(current.id),...(issue.field==='purchasePriceCents'||issue.field==='downPaymentCents'?{recordId:context.draft.recordId,field:'property.'+issue.field}:{})})));if(context.ui)syncFormFeedback(ownerFor(root),controller,context.ui);return;}
    setFormTaskIssues(node.closest<HTMLElement>('form')!,[]);
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
function renderRental(root:HTMLElement,controller:WorkspaceController,context:FieldContext,path:FieldPath):void {
  const unit=at(context,path) as RawObject,unitLabel=rentalOptions(controller,context,context.draft.recordId).find(option=>option.value===unit.id)?.label.split(' — ')[0]??'Rental unit',disclosure=details(root,`Rental unit — ${unitLabel}`,{key:`${String(unit.id)}:rental`,initialOpen:!controller.getState().savedPlan.rentals.some(r=>r.id===unit.id),status:`${unknownCount(unit)} unknown facts`}),node=group(disclosure,'Rental details');disclosure.dataset.fieldGroup=path.join('.');registerFormSummary(disclosure,()=>`${unknownCount(at(context,path))} unknown facts`);
  field(node,context,[...path,'monthlyRentCents'],'Monthly rent receipts',{kind:'money'});field(node,context,[...path,'rentGrowthBps'],'Effective annual rent growth (%)',{kind:'rate'});field(node,context,[...path,'rentStartDate'],'Lease income start date',{kind:'date'});field(node,context,[...path,'rentEndDate'],'Lease income end date (optional)',{kind:'date',optional:true});field(node,context,[...path,'availableDate'],'Available for rent date',{kind:'date'});
  node.append(element('p','Available by forecast start; rent may begin later. Building basis excludes land and differs from market value.'));
  booleanHistory(node,context,[...path,'activeParticipation'],'Active participation');
  field(node,displayed(context,[...path,'sharedAllocation'],at(context,[...path,'sharedAllocation'])?'explicit':'default',value=>{context.onChange([...path,'sharedAllocation'],value==='explicit'?{numerator:'',denominator:''}:undefined);context.refresh();}),[...path,'sharedAllocation'],'Shared-cost allocation',{kind:'select',options:[{value:'default',label:'Default property / area allocation'},{value:'explicit',label:'Explicit share'}]});
  if(at(context,[...path,'sharedAllocation']))allocationFields(node,context,[...path,'sharedAllocation']);
  for(const [key,label]of [['longTermFairMarketLease','Long-term fair-market lease'],['noPersonalUse','Rental has no personal use'],['noSubstantialTenantServices','No substantial tenant services'],['ordinaryResidential','Ordinary residential rental'],['advancedBasisAdjustments','Advanced basis adjustments apply'],['californiaSmallBusinessQualification','California AMT small-business qualification']] as const)booleanHistory(node,context,[...path,'qualifications',key],label);
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
  for(const [book,label]of books)historyBook(node,context,[...path,'taxHistory',book],label);
  const qbiDisclosure=details(node,'QBI history',{key:`${String(unit.id)}:qbi`,status:`${unknownCount(unit.qbi)} unknown facts`});qbiDisclosure.dataset.fieldGroup=[...path,'qbi'].join('.');registerFormSummary(qbiDisclosure,()=>`${unknownCount(at(context,[...path,'qbi']))} unknown facts`);const qbi=group(qbiDisclosure,'Qualified business income');booleanHistory(qbi,context,[...path,'qbi','qualification'],'QBI qualification');moneyHistory(qbi,context,[...path,'qbi','wagesCents'],'QBI wages');moneyHistory(qbi,context,[...path,'qbi','ubiaCents'],'Unadjusted qualified property basis (UBIA)');
  const lossPath=[...path,'qbi','openingLossVintages'],losses=at(context,lossPath) as {known?:boolean;value?:readonly RawObject[]}|undefined;
  field(qbi,displayed(context,lossPath,losses?.known?'known':'unknown',value=>{context.onChange(lossPath,value==='known'?{known:true,value:[]}:unknown());context.refresh();}),lossPath,'QBI loss history',{kind:'select',options:[{value:'unknown',label:'Unknown'},{value:'known',label:'Enter losses'}]});
  if(losses?.known)qbi.append(element('small','No rows means confirmed no prior losses.'));
  if(losses?.known)rows(qbi,context,[...lossPath,'value'],'QBI loss vintage','Add QBI loss vintage','Remove QBI loss vintage',()=>({year:'',amountCents:''}),(row,p)=>{field(row,context,[...p,'year'],'Loss year',{kind:'integer'});field(row,context,[...p,'amountCents'],'Loss amount',{kind:'money'});});
}
function renderExpense(root:HTMLElement,controller:WorkspaceController,context:FieldContext,path:FieldPath):void {
  const expense=at(context,path) as RawObject,node=group(root,`Property expense — ${String(expense.name??expense.id)}`);
  field(node,context,[...path,'name'],'Property expense name');field(node,context,[...path,'amountCents'],'Property expense amount',{kind:'money'});field(node,context,[...path,'frequency'],'Property expense frequency',{kind:'select',options:['monthly','annual']});field(node,context,[...path,'startDate'],'Property expense start date',{kind:'date'});field(node,context,[...path,'endDate'],'Property expense end date (optional)',{kind:'date',optional:true});field(node,context,[...path,'annualGrowthBps'],'Property expense annual growth (%)',{kind:'rate'});
  field(node,context,[...path,'taxCategory'],'Property expense category',{kind:'select',options:taxCategoryOptions,refresh:true});
  field(node,context,[...path,'use'],'Property expense use',{kind:'select',options:['personal','rental','shared'],refresh:true});
  if(at(context,[...path,'use'])==='rental')field(node,context,[...path,'rentalId'],'Direct expense rental unit',{kind:'select',options:rentalOptions(controller,context,context.draft.recordId)});
  if(at(context,[...path,'use'])==='shared'){
    const override=[...path,'allocationOverride'];field(node,displayed(context,override,at(context,override)?'explicit':'default',value=>{context.onChange(override,value==='explicit'?{numerator:'',denominator:''}:undefined);context.refresh();}),override,'Expense shared allocation',{kind:'select',options:[{value:'default',label:'Default rental allocation'},{value:'explicit',label:'Explicit expense share'}]});
    if(at(context,override))allocationFields(node,context,override);
  }
  if(at(context,[...path,'taxCategory'])==='mortgage-insurance')booleanHistory(node,context,[...path,'mortgageInsuranceQualification'],'Personal mortgage insurance qualified');
}
function propertyFields(root:HTMLElement,controller:WorkspaceController,context:FieldContext):void {
  const path=['property'],property=at(context,path) as RawObject;
  field(root,context,[...path,'name'],'Property name');field(root,context,[...path,'role'],'Property role',{kind:'select',options:[{value:'primary',label:'Primary home'},{value:'rental',label:'Whole-property rental'},{value:'primary-with-adu',label:'Primary home with ADU'}],refresh:true});field(root,context,[...path,'purchaseDate'],'Purchase date',{kind:'date',hint:'The property must exist by Jan 1 of the forecast start year.'});field(root,context,[...path,'purchasePriceCents'],'Purchase price',{kind:'money'});field(root,context,[...path,'downPaymentCents'],'Down payment',{kind:'money'});field(root,context,[...path,'openingValueCents'],property.role==='primary-with-adu'?'Combined home and ADU market value at forecast start':'Property market value at forecast start',{kind:'money',hint:`As of Jan 1, ${controller.getState().savedPlan.startYear}.${property.role==='primary-with-adu'?' Includes the home and ADU together.':''}`});field(root,context,[...path,'appreciationBps'],'Effective annual appreciation (%)',{kind:'rate'});
  if(property.role==='primary-with-adu') {
    field(root,context,[...path,'primaryArea'],'Primary home living area',{kind:'text',hint:'Use the same area units for home and ADU; fractions are allowed.'});field(root,context,[...path,'aduArea'],'ADU living area',{kind:'text'});
    const decoded=fromDraftValue(context.draft.value,context.draft.recordId);
    if(decoded.issues.length===0){
      const defaultUnits=(decoded.value.rentals as readonly RentalUnit[]).map(({sharedAllocation:_override,...unit})=>unit);
      const allocation=defaultRentalAllocation(decoded.value.property as unknown as Property,defaultUnits);
      root.append(element('p',allocation.status==='available'?`Default ADU shared allocation: ${Object.values(allocation.value).join(', ')||'add a rental unit'}. Explicit expense and loan allocations remain independent.`:`Default ADU shared allocation unavailable: ${allocation.issues.map(i=>i.explanation).join(' ')}`));
    }else root.append(element('p','Default ADU shared allocation requires valid entered areas and amounts.'));
  }
  rows(details(root,'Yearly appreciation overrides',{key:`${context.draft.recordId}:appreciation`,status:`${(at(context,[...path,'appreciationOverrides']) as readonly unknown[]).length} overrides`}),context,[...path,'appreciationOverrides'],'Appreciation override','Add appreciation override','Remove appreciation override',()=>({year:'',rateBps:''}),(row,p)=>{field(row,context,[...p,'year'],'Appreciation year',{kind:'integer'});field(row,context,[...p,'rateBps'],'Appreciation rate (%)',{kind:'rate'});});
  const loans=at(context,[...path,'loans']) as readonly RawObject[];
  for(const [index]of loans.entries()){const section=element('section');disclosureRoots.set(section,ownerFor(root));renderLoan(section,controller,context,[...path,'loans',index]);section.append(button('Remove loan',()=>{context.onChange([...path,'loans'],(at(context,[...path,'loans']) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));root.append(section);}
  root.append(button('Add loan',()=>{
    const date=`${controller.getState().savedPlan.startYear}-01-01`,loan:RawObject={id:idFor(controller,context,'loan'),name:'Purchase loan',originalPrincipalCents:'',aprBps:'0.00',originationDate:at(context,['property','purchaseDate']),acquisitionDate:at(context,['property','purchaseDate']),termMonths:'360',firstPaymentDate:`${date.slice(0,7)}-31`,openingBalance:unknown(),openingPayment:unknown(),collateralPropertyId:context.draft.recordId,proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:unknown(),qualifiedPrincipalCents:unknown(),historyComplete:unknown()},proceedsAllocations:[],financingAtRiskQualification:unknown()},initialized=purchaseTerms(context,loan);
    context.onChange([...path,'loans'],[...(at(context,[...path,'loans']) as readonly RawObject[]),initialized.status==='available'?loanWithTerms(loan,initialized.value):loan]);context.refresh();
  }));
  const rentals=at(context,['rentals']) as readonly RawObject[];
  for(const [index]of rentals.entries()){const section=element('section');disclosureRoots.set(section,ownerFor(root));renderRental(section,controller,context,['rentals',index]);section.append(button('Remove rental unit',()=>{context.onChange(['rentals'],(at(context,['rentals']) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));root.append(section);}
  if(property.role!=='primary')root.append(button('Add rental unit',()=>{const date=`${controller.getState().savedPlan.startYear}-01-01`;context.onChange(['rentals'],[...(at(context,['rentals']) as readonly RawObject[]),{id:idFor(controller,context,'rental'),propertyId:context.draft.recordId,monthlyRentCents:'0.00',rentGrowthBps:'0.00',rentStartDate:date,availableDate:date,activeParticipation:unknown(),loanAllocations:[],qualifications:{longTermFairMarketLease:unknown(),noPersonalUse:unknown(),noSubstantialTenantServices:unknown(),ordinaryResidential:unknown(),advancedBasisAdjustments:unknown(),californiaSmallBusinessQualification:unknown()},convertedFromPersonalUse:false,conversionBuildingFmv:unknown(),taxHistory:Object.fromEntries(books.map(([book])=>[book,unknown()])),qbi:{qualification:unknown(),wagesCents:unknown(),ubiaCents:unknown(),openingLossVintages:unknown()}}]);context.refresh();}));
  for(const [index]of (at(context,['expenses']) as readonly RawObject[]).entries()){const section=element('section');disclosureRoots.set(section,ownerFor(root));renderExpense(section,controller,context,['expenses',index]);section.append(button('Remove property expense',()=>{context.onChange(['expenses'],(at(context,['expenses']) as readonly RawObject[]).filter((_,i)=>i!==index));context.refresh();}));root.append(section);}
  root.append(button('Add property expense',()=>{context.onChange(['expenses'],[...(at(context,['expenses']) as readonly RawObject[]),{id:idFor(controller,context,'expense'),name:'Property expense',amountCents:'0.00',frequency:'monthly',startDate:`${controller.getState().savedPlan.startYear}-01-01`,annualGrowthBps:'0.00',propertyId:context.draft.recordId,use:'personal',taxCategory:'personal'}]);context.refresh();}));
}
/** Related property, loan, rental and expense rows remain one revisioned draft. */
export function renderPropertiesForm(root:HTMLElement,controller:WorkspaceController,ui?:IssueViewContext):void {
  captureDisclosures(root);disclosureRoots.set(root,root);ui?.disclosures.closeWithin(root,false);root.replaceChildren();root.append(element('h2','Properties'),element('p','Only existing properties and rentals are supported. Future purchases, rental conversions, refinance, construction and sales are unsupported.'));
  const state=controller.getState(),ids=[...new Set([...state.savedPlan.properties.map(p=>p.id),...Object.values(state.drafts).filter(d=>d.section==='properties').map(d=>d.recordId)])];
  for(const id of ids){
    const card=element('form');card.dataset.recordId=id;card.dataset.editableSection='properties';const body=element('div');disclosureRoots.set(body,root);card.append(element('h3',String(controller.getDraft('properties',id).value.property&& (controller.getDraft('properties',id).value.property as RawObject).name||'Property')),body);
    const context:FieldContext={...(ui?{ui}:{}),get draft(){return controller.getDraft('properties',id);},get issues(){return controller.getState().issues;},onChange(path,value){setFormTaskIssues(card,[]);const draft=controller.getDraft('properties',id);controller.editDraft(id,{...draft,value:setAt(draft.value,path,value)});},refresh(){captureDisclosures(body);ui?.disclosures.closeWithin(body,false);refreshFields(body,()=>propertyFields(body,controller,context));if(ui)syncFormFeedback(root,controller,ui);}};
    context.refresh();const save=element('button','Save property');save.type='submit';card.append(save,button('Remove property',()=>controller.removeRecord('properties',id)));card.addEventListener('submit',event=>{event.preventDefault();controller.saveProperty(id);});
    card.append(element('small','Discards this draft and reloads applied inputs.'),button('Discard edits',()=>{controller.discardDraft(id);renderPropertiesForm(root,controller,ui);}));
    root.append(card);
  }
  if(ui)syncFormFeedback(root,controller,ui);
  root.append(button('Add property',()=>controller.beginAdd('properties')));
}
