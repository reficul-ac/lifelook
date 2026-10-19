import type {PropertyDraftBundle} from './adu-project-draft';
import {isValidISODate} from '../engine/dates';
import type {RawObject} from './state';

function followingMonth(date:unknown):string|undefined {
 if(!isValidISODate(date))return undefined;
 const year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
 if(month===12&&year===9999)return undefined;
 return `${String(month===12?year+1:year).padStart(4,'0')}-${String(month===12?1:month+1).padStart(2,'0')}`;
}
function singleStage(project:RawObject):RawObject|undefined {
 const costs=project.costs as readonly RawObject[]|undefined;
 return Array.isArray(costs)&&costs.length===1?costs[0]:undefined;
}
function simpleLoan(project:RawObject){
 const stage=singleStage(project),financing=project.financing as RawObject|undefined;
 if(!stage||!financing||!Array.isArray(financing.draws)||financing.draws.length!==1||!Array.isArray(financing.interestTaxRows)||financing.interestTaxRows.length)return undefined;
 const draw=financing.draws[0] as RawObject;
 if(!Array.isArray(draw.costAllocations)||draw.costAllocations.length!==1)return undefined;
 const allocation=draw.costAllocations[0] as RawObject;
 return allocation.costId===stage.id?{financing,draw,allocation}:undefined;
}
function withProject(bundle:PropertyDraftBundle,project:RawObject):PropertyDraftBundle {
 return {...bundle,property:{...bundle.property,aduProject:project}};
}

/** Move only dates that still match the defaults generated for completion. */
export function setAduCompletionDate(bundle:PropertyDraftBundle,date:string):PropertyDraftBundle {
 const project=bundle.property.aduProject as RawObject|undefined;if(!project)return bundle;
 const metadata=project.__draft as RawObject|undefined;
 const previousCompletion=isValidISODate(project.completionDate)?project.completionDate:isValidISODate(metadata?.lastValidCompletionDate)?metadata.lastValidCompletionDate:undefined;
 // Native date inputs can emit blanks between valid dates. Keep their anchor
 // only in draft metadata, which is discarded when the bundle is decoded.
 const anchor=isValidISODate(date)?date:previousCompletion;
 let result=withProject(bundle,{...project,completionDate:date,...(anchor?{__draft:{...metadata,lastValidCompletionDate:anchor}}:{})});
 if(!isValidISODate(date)||!previousCompletion)return result;
 const next=followingMonth(date),previous=followingMonth(previousCompletion),stage=singleStage(project);
 const costs=stage&&stage.paymentDate===previousCompletion?[{...stage,paymentDate:date}]:project.costs;
 result=withProject(result,{...result.property.aduProject as RawObject,costs});
 if(next&&previous)result={...result,rentals:bundle.rentals.map(rental=>rental.id===project.rentalId?{
  ...rental,
  ...(rental.availableDate===`${previous}-01`?{availableDate:`${next}-01`}:{}),
  ...(rental.rentStartDate===`${previous}-01`?{rentStartDate:`${next}-01`}:{}),
 }:rental)};
 const loan=simpleLoan(project);
 if(loan)result=withProject(result,{...result.property.aduProject as RawObject,financing:{...loan.financing,
  ...(next&&previous&&loan.financing.firstAmortizingPaymentMonth===previous?{firstAmortizingPaymentMonth:next}:{}),
  draws:[{...loan.draw,...(loan.draw.month===previousCompletion.slice(0,7)?{month:date.slice(0,7)}:{})}],
 }});
 return result;
}

export function addSimpleAduFinancing(bundle:PropertyDraftBundle,nextId:(kind:string)=>string):PropertyDraftBundle {
 const project=bundle.property.aduProject as RawObject|undefined;if(!project||project.financing)return bundle;
 const stage=singleStage(project);if(!stage)return bundle;
 const completion=isValidISODate(project.completionDate)?project.completionDate:(project.__draft as RawObject|undefined)?.lastValidCompletionDate;
 const month=isValidISODate(completion)?completion.slice(0,7):'';
 return withProject(bundle,{...project,financing:{
  id:nextId('adu-financing'),name:'ADU financing',aprBps:'',termMonths:'360',collateralPropertyId:bundle.property.id,
  firstAmortizingPaymentMonth:followingMonth(completion)??'',
  draws:[{id:nextId('adu-draw'),month,amountCents:'',costAllocations:[{costId:stage.id,amountCents:''}]}],
  interestTaxRows:[],proceedsHistoryComplete:{known:false},rentalInterestQualified:{known:false},financingAtRiskQualification:{known:false},
 }});
}

export function setSimpleAduLoanAmount(bundle:PropertyDraftBundle,amount:string,nextId:(kind:string)=>string):PropertyDraftBundle {
 const result=addSimpleAduFinancing(bundle,nextId),project=result.property.aduProject as RawObject|undefined;
 if(!project)return result;
 const loan=simpleLoan(project);if(!loan)return result;
 return withProject(result,{...project,financing:{...loan.financing,draws:[{...loan.draw,amountCents:amount,costAllocations:[{...loan.allocation,amountCents:amount}]}]}});
}
