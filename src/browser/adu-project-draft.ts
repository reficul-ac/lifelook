import {toDraftValue,type RawObject} from './state';
export interface PropertyDraftBundle {readonly property:RawObject;readonly rentals:readonly RawObject[];readonly expenses:readonly RawObject[]}
const books=['federal','california','federal-amt','california-amt'] as const;
const unknown=()=>({known:false});
const zeroBook=()=>({recoveryBasisCents:0,adjustedBuildingBasisCents:0,cumulativeDepreciationCents:0,atRiskCents:0,atRiskSuspendedCents:0,passiveSuspendedCents:0,lossVintages:[]});
export function addAduProjectDraft(bundle:PropertyDraftBundle,startYear:number,nextId:(kind:string)=>string):PropertyDraftBundle {
 if(bundle.property.aduProject)return bundle;
 if(bundle.property.role!=='primary'||bundle.rentals.length)throw new Error('A new ADU requires an existing primary home without an existing rental.');
 const rentalId=nextId('adu-rental'),projectId=nextId('adu-project'),stageId=nextId('adu-stage'),start=`${startYear}-01-01`,completion=`${startYear}-12-31`,ready=`${startYear+1}-01-01`;
 const rental=toDraftValue({id:rentalId,propertyId:bundle.property.id,availableDate:ready,rentStartDate:ready,monthlyRentCents:'',rentGrowthBps:0,vacancyBps:0,
  activeParticipation:unknown(),loanAllocations:[],convertedFromPersonalUse:false,conversionBuildingFmv:unknown(),
  qualifications:Object.fromEntries(['longTermFairMarketLease','noPersonalUse','noSubstantialTenantServices','ordinaryResidential','advancedBasisAdjustments','californiaSmallBusinessQualification'].map(key=>[key,unknown()])),
  taxHistory:Object.fromEntries(books.map(book=>[book,{known:true,value:zeroBook()}])),qbi:{qualification:unknown(),wagesCents:unknown(),ubiaCents:unknown(),openingLossVintages:{known:true,value:[]}},
 });
 const project={id:projectId,name:'ADU build',rentalId,constructionStartDate:start,completionDate:completion,
  costs:[{id:stageId,name:'Construction',paymentDate:completion,amountCents:'',category:'building',treatments:Object.fromEntries(books.map(book=>[book,unknown()]))}],
  valuation:{kind:'adu-value-per-square-foot',valuePerSquareFootCents:''},sharedExpenseOverrides:[],
  propertyTax:{addedAssessedValueCents:unknown(),marginalRateBps:unknown(),annualAssessmentGrowthBps:'2.00',completedValueEnrollmentYear:String(startYear+1),additionalAnnualChargesCents:'0.00',constructionAssessments:[],paymentYears:[{year:String(startYear),complete:unknown(),payments:[]}],originalExpenseExcludesAdu:unknown()},
  taxQualifications:Object.fromEntries(books.map(book=>[book,unknown()])),productionPeriod:unknown(),supportOperatingDeficits:unknown(),
 };
 return{...bundle,property:{...bundle.property,role:'primary-with-adu',aduArea:bundle.property.aduArea??'',aduProject:project},rentals:[...bundle.rentals,rental]};
}
export function removeAduProjectDraft(bundle:PropertyDraftBundle):PropertyDraftBundle {
 const project=bundle.property.aduProject as RawObject|undefined;if(!project)return bundle;
 const {aduProject,...property}=bundle.property;
 if(property.aduArea==='')delete property.aduArea;
 return{property:{...property,role:'primary'},rentals:bundle.rentals.filter(r=>r.id!==project.rentalId),expenses:bundle.expenses.filter(e=>e.rentalId!==project.rentalId)};
}
