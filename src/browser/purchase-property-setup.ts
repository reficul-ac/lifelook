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
  next.rentals=(next.rentals as readonly RawObject[]).map(unit=>({...unit,...(oldDates.includes(unit.availableDate)?{availableDate:newDate}:{}),...(oldDates.includes(unit.rentStartDate)?{rentStartDate:newDate}:{})}));
  next.expenses=(next.expenses as readonly RawObject[]).map(expense=>({...expense,...(oldDates.includes(expense.startDate)?{startDate:newDate}:{})}));
  const oldPaymentDates=[purchaseFirstPaymentDate(previous.purchaseDate),...(newProperty&&!previousFuture?[`${startYear}-01-31`]:[])];
  property.loans=(property.loans as readonly RawObject[]).map(loan=>({...loan,...(loan.originationDate===previous.purchaseDate?{originationDate:newDate}:{}),...(loan.acquisitionDate===previous.purchaseDate?{acquisitionDate:newDate}:{}),...(oldPaymentDates.includes(loan.firstPaymentDate as string)?{firstPaymentDate:purchaseFirstPaymentDate(newDate)??newDate}:{})}));
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
