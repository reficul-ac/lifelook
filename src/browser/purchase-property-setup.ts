import {calendarDate,isValidISODate,parseISODate} from '../engine/dates';
import {parseMoneyInput,setAt,type FieldPath} from './fields';
import {Decimal,settleCents} from '../engine/money';
import {toDraftValue,type RawObject} from './state';

const unknown=()=>({known:false});
export function isFuturePropertyPurchase(property:RawObject,startYear:number):boolean{return isValidISODate(property.purchaseDate)&&property.purchaseDate>`${startYear}-01-01`;}
export function purchaseFirstPaymentDate(date:unknown):string|undefined {
 if(!isValidISODate(date))return undefined;
 const {year,month}=parseISODate(date);if(year===9999&&month===12)return undefined;
 return calendarDate(month===12?year+1:year,month===12?1:month+1,31);
}
export function createPropertyRentalDraft(property:RawObject,date:string,id:string):RawObject {
 return {id,propertyId:property.id,monthlyRentCents:'0.00',rentGrowthBps:'0.00',rentStartDate:date,availableDate:date,activeParticipation:unknown(),loanAllocations:[],qualifications:Object.fromEntries(['longTermFairMarketLease','noPersonalUse','noSubstantialTenantServices','ordinaryResidential','advancedBasisAdjustments','californiaSmallBusinessQualification'].map(key=>[key,unknown()])),convertedFromPersonalUse:false,conversionBuildingFmv:unknown(),taxHistory:Object.fromEntries(['federal','california','federal-amt','california-amt'].map(book=>[book,unknown()])),qbi:{qualification:unknown(),wagesCents:unknown(),ubiaCents:unknown(),openingLossVintages:unknown()}};
}
const equalMoney=(left:unknown,right:unknown):boolean=>{const a=parseMoneyInput(String(left??'')),b=parseMoneyInput(String(right??''));return a.status==='available'&&b.status==='available'&&a.value===b.value;};
function principal(property:RawObject):string|undefined {
 const price=parseMoneyInput(String(property.purchasePriceCents??'')),down=parseMoneyInput(String(property.downPaymentCents??''));
 if(price.status!=='available'||down.status!=='available'||price.value<down.value)return undefined;
 return toDraftValue(settleCents(new Decimal(price.value).minus(down.value)),'originalPrincipalCents');
}
/** Move purchase defaults together; independently entered dates and values stay entered. */
export function updatePropertyPurchaseDraft(bundle:RawObject,path:FieldPath,entry:unknown,startYear:number,nextId:()=>string,newProperty:boolean):RawObject {
 const previous=bundle.property as RawObject,next=setAt(bundle,path,entry),property=next.property as RawObject;
 const changed=path.join('.'),future=isFuturePropertyPurchase(property,startYear),previousFuture=isFuturePropertyPurchase(previous,startYear);
 const loanDate=/^property\.loans\.(\d+)\.(firstPaymentDate|originationDate|acquisitionDate)$/.exec(changed);
 if(loanDate){const loan=valueAtLoan(property,loanDate[1]);if(loan)loan.__draft={...(loan.__draft as RawObject|undefined),[`${loanDate[2]}Entered`]:true};}
 const rentalDate=/^rentals\.(\d+)\.(availableDate|rentStartDate)$/.exec(changed);
 if(rentalDate){const unit=(next.rentals as RawObject[])[Number(rentalDate[1])];if(unit)unit.__draft={...(unit.__draft as RawObject|undefined),[`${rentalDate[2]}Entered`]:true};}
 const project=property.aduProject as RawObject|undefined;
 if(project){
  const stageDate=/^property\.aduProject\.costs\.(\d+)\.paymentDate$/.exec(changed);if(stageDate){const stage=(project.costs as RawObject[])[Number(stageDate[1])];if(stage)stage.__draft={...(stage.__draft as RawObject|undefined),paymentDateEntered:true};}
  const financing=project.financing as RawObject|undefined;if(financing){
   if(changed==='property.aduProject.financing.firstAmortizingPaymentMonth')financing.__draft={...(financing.__draft as RawObject|undefined),firstAmortizingPaymentMonthEntered:true};
   const drawDate=/^property\.aduProject\.financing\.draws\.(\d+)\.month$/.exec(changed);if(drawDate){const draw=(financing.draws as RawObject[])[Number(drawDate[1])];if(draw)draw.__draft={...(draw.__draft as RawObject|undefined),monthEntered:true};}
  }
 }
 if(changed==='property.openingValueCents'&&future)property.__draft={...(property.__draft as RawObject|undefined),purchaseValueEntered:true};
 if(future&&!property.aduProject){
  if(!property.purchaseFunding)property.purchaseFunding={kind:'household-cash'};
  if(!property.purchaseTaxEstimation)property.purchaseTaxEstimation={mode:'simple',buildingShareBps:'80.00'};
  const metadata=property.__draft as RawObject|undefined,manual=metadata?.purchaseValueEntered===true;
  if(!manual&&(changed==='property.purchasePriceCents'&&(metadata?.purchaseValueAutomatic===true||equalMoney(previous.openingValueCents,previous.purchasePriceCents))||changed==='property.purchaseDate'&&!previousFuture&&equalMoney(previous.openingValueCents,'0.00'))){property.openingValueCents=property.purchasePriceCents;property.__draft={...metadata,purchaseValueAutomatic:true};}
  if(newProperty&&(changed==='property.purchaseDate'||changed==='property.role')&&property.role==='rental'&&Array.isArray(next.rentals)&&next.rentals.length===0)next.rentals=[createPropertyRentalDraft(property,String(property.purchaseDate),nextId())];
 }
 if(changed==='property.purchaseDate'&&isValidISODate(property.purchaseDate)&&(newProperty||previousFuture)){
  const oldDates=[previous.purchaseDate,...(!previousFuture?[`${startYear}-01-01`]:[])],newDate=property.purchaseDate;
  next.rentals=(next.rentals as readonly RawObject[]).map(unit=>({...unit,...(!(unit.__draft as RawObject|undefined)?.availableDateEntered&&oldDates.includes(unit.availableDate)?{availableDate:newDate}:{}),...(!(unit.__draft as RawObject|undefined)?.rentStartDateEntered&&oldDates.includes(unit.rentStartDate)?{rentStartDate:newDate}:{})}));
  next.expenses=(next.expenses as readonly RawObject[]).map(expense=>({...expense,...(oldDates.includes(expense.startDate)?{startDate:newDate}:{})}));
  const oldPaymentDates=[purchaseFirstPaymentDate(previous.purchaseDate),...(newProperty&&!previousFuture?[`${startYear}-01-31`]:[])];
  property.loans=(property.loans as readonly RawObject[]).map(loan=>({...loan,...(!(loan.__draft as RawObject|undefined)?.originationDateEntered&&loan.originationDate===previous.purchaseDate?{originationDate:newDate}:{}),...(!(loan.__draft as RawObject|undefined)?.acquisitionDateEntered&&loan.acquisitionDate===previous.purchaseDate?{acquisitionDate:newDate}:{}),...(!(loan.__draft as RawObject|undefined)?.firstPaymentDateEntered&&oldPaymentDates.includes(loan.firstPaymentDate as string)?{firstPaymentDate:purchaseFirstPaymentDate(newDate)??newDate}:{})}));
 }
 if(future&&(changed==='property.purchasePriceCents'||changed==='property.downPaymentCents')){
  const oldPrincipal=principal(previous),newPrincipal=principal(property),loans=property.loans as readonly RawObject[];
  const loan=loans[0],metadata=loan?.__draft as RawObject|undefined;
  if(loans.length===1&&loan?.proceedsQualification&&(loan.proceedsQualification as RawObject).kind==='acquisition'&&metadata?.purchasePrincipalEntered!==true&&(metadata?.purchasePrincipalAutomatic===true||equalMoney(loan.originalPrincipalCents,oldPrincipal)))property.loans=[{...loan,...(newPrincipal===undefined?{}:{originalPrincipalCents:newPrincipal}),__draft:{...metadata,purchasePrincipalAutomatic:true}}];
 }
 if(future&&/^property\.loans\.\d+\.originalPrincipalCents$/.test(changed)){const loan=valueAtLoan(property,path[2]);if(loan)loan.__draft={...(loan.__draft as RawObject|undefined),purchasePrincipalEntered:true};}
 return next;
}
function valueAtLoan(property:RawObject,index:unknown):RawObject|undefined{return(property.loans as readonly RawObject[])[Number(index)];}
