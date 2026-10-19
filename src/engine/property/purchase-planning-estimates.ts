import {Decimal,settleCents} from '../money';
import type {AllocationShare,History,Property,PropertyLoan,RentalBookState,RentalUnit,TaxBook,ValidatedPlan} from '../model/plan';
import type {RuleProvenance} from '../model/results';
import {validatePlan} from '../validation';
import {allocateShares,loanRentalShares,sharedRentalShares} from './allocation';

const books:readonly TaxBook[]=['federal','california','federal-amt','california-amt'];
const known=<T>(answer:History<T>,value:T):History<T>=>answer.known?answer:{known:true,value};
export function isFuturePropertyPurchase(property:Property,startYear:number):boolean {
 return property.purchaseDate>`${startYear}-01-01`;
}
function fraction(value:Decimal):AllocationShare {
 const [numerator,denominator]=value.toFraction(Number.MAX_SAFE_INTEGER);
 return{numerator:numerator!.toNumber(),denominator:denominator!.toNumber()};
}
function loanEstimates(property:Property,units:readonly RentalUnit[]):readonly PropertyLoan[] {
 return property.loans.map(loan=>{
  const shares=loanRentalShares(loan,property,units),rentalShare=Object.values(shares).reduce((total,share)=>total.plus(share),new Decimal(0));
  const allocations=[...units.filter(unit=>shares[unit.id]?.gt(0)).map(unit=>({propertyId:property.id,rentalId:unit.id,use:'rental' as const,share:fraction(shares[unit.id]!)})),
   ...(rentalShare.lt(1)?[{propertyId:property.id,use:'personal' as const,share:fraction(new Decimal(1).minus(rentalShare))}]:[])];
  return{...loan,financingAtRiskQualification:known(loan.financingAtRiskQualification,true),
   proceedsQualification:{...loan.proceedsQualification,qualifiedAcquisitionDebt:known(loan.proceedsQualification.qualifiedAcquisitionDebt,true),qualifiedPrincipalCents:known(loan.proceedsQualification.qualifiedPrincipalCents,loan.originalPrincipalCents),historyComplete:known(loan.proceedsQualification.historyComplete,true)},
   proceedsAllocations:loan.proceedsAllocations.length?loan.proceedsAllocations:allocations};
 });
}

/** Disposable acquisition facts: entered books and qualifications always take precedence. */
export function resolvePurchasePlanningEstimates(plan:ValidatedPlan):ValidatedPlan {
 let changed=false;
 const rentals=new Map(plan.rentals.map(unit=>[unit.id,unit]));
 const properties=plan.properties.map(property=>{
  if(!isFuturePropertyPurchase(property,plan.startYear)||property.purchaseTaxEstimation?.mode!=='simple')return property;
  changed=true;
  const units=plan.rentals.filter(unit=>unit.propertyId===property.id);
  const loans=loanEstimates(property,units),resolved={...property,loans};
  const shares=sharedRentalShares(property,units);
  const basis=allocateShares(settleCents(new Decimal(property.purchasePriceCents).times(property.purchaseTaxEstimation.buildingShareBps).div(10000)),shares).rentalCentsByUnit;
  const cashRisk=allocateShares(property.downPaymentCents,shares).rentalCentsByUnit;
  const borrowedRisk=loans.filter(loan=>loan.financingAtRiskQualification.known&&loan.financingAtRiskQualification.value).map(loan=>allocateShares(loan.originalPrincipalCents,loanRentalShares(loan,resolved,units)).rentalCentsByUnit);
  for(const unit of units){
   // Personal-use conversions need their independent fair-market-value facts.
   if(unit.convertedFromPersonalUse)continue;
   const building=basis[unit.id]??0,atRisk=settleCents(borrowedRisk.reduce((total,allocation)=>total.plus(allocation[unit.id]??0),new Decimal(cashRisk[unit.id]??0)));
   const opening:RentalBookState={recoveryBasisCents:building,adjustedBuildingBasisCents:building,cumulativeDepreciationCents:0,atRiskCents:atRisk,atRiskSuspendedCents:0,passiveSuspendedCents:0,lossVintages:[]};
   const allocations=loans.flatMap(loan=>{
    const existing=unit.loanAllocations.find(allocation=>allocation.loanId===loan.id);
    if(existing)return[{...existing,qualification:known(existing.qualification,true)}];
    const share=loanRentalShares(loan,resolved,units)[unit.id];
    return share?.gt(0)?[{loanId:loan.id,share:fraction(share),qualification:{known:true as const,value:true}}]:[];
   });
   rentals.set(unit.id,{...unit,activeParticipation:known(unit.activeParticipation,false),
    loanAllocations:[...unit.loanAllocations.filter(allocation=>!loans.some(loan=>loan.id===allocation.loanId)),...allocations],
    qualifications:{...unit.qualifications,ordinaryResidential:known(unit.qualifications.ordinaryResidential,true),longTermFairMarketLease:known(unit.qualifications.longTermFairMarketLease,true),noPersonalUse:known(unit.qualifications.noPersonalUse,true),noSubstantialTenantServices:known(unit.qualifications.noSubstantialTenantServices,true),advancedBasisAdjustments:known(unit.qualifications.advancedBasisAdjustments,false),californiaSmallBusinessQualification:known(unit.qualifications.californiaSmallBusinessQualification??{known:false},false)},
    taxHistory:Object.fromEntries(books.map(book=>[book,known(unit.taxHistory[book],opening)])) as RentalUnit['taxHistory'],
    qbi:{...unit.qbi,qualification:known(unit.qbi.qualification,false),openingLossVintages:known(unit.qbi.openingLossVintages,[])}});
  }
  return resolved;
 });
 if(!changed)return plan;
 const result=validatePlan({...plan,properties,rentals:plan.rentals.map(unit=>rentals.get(unit.id)!)});
 return result.ok?result.plan:plan;
}

export function purchaseEstimateProvenance(year:number):RuleProvenance {
 return{status:'provisional',ruleVersion:'property-purchase-planning.1',baselineYear:2026,applicableYear:year,
  sources:['https://www.irs.gov/publications/p527','https://www.irs.gov/publications/p551','https://www.irs.gov/publications/p925','https://www.irs.gov/publications/p936'],
  assumptions:[
   'Purchase planning estimates preserve entered facts and derive unanswered qualifications without changing saved inputs. They assume an ordinary residential acquisition and dedicated purchase borrowing.',
   'Purchase value and mortgage principal enter in the closing month; appreciation and regular mortgage interest begin the following month. Explicit closing-month payments are honored. Closing costs and prepaid closing interest are not modeled automatically.',
   'The entered building share allocates purchase cost between depreciable buildings and nondepreciable land. Its initial 80% is an editable planning assumption, not an assessed allocation. Closing costs and later improvements require separate inputs.',
   'New rental books begin with purchase building cost, zero prior depreciation and losses, and owner cash plus borrowing that qualifies for the at-risk rules. Shared rental and traced loan allocations remain independent.',
   'Building recovery begins when the property is ready and available for rent, using the existing residential mid-month recovery method. Unknown participation and QBI qualifications claim no related benefit.',
   'Unanswered purchase-loan qualifications assume acquisition debt secured by the purchased property, complete dedicated proceeds tracing and qualifying financing. Explicit qualifications and entered tax books override these estimates.',
   'The household is assumed to support each monthly rental operating deficit, including principal. That support enters at-risk capital once; qualifying principal and nondeductible costs reduce it. Actual household cash costs and funding gaps remain in the forecast, with gaps conditional on funding.',
   'Personal-use conversions and unrelated household tax circumstances retain their independent history requirements.',
  ]};
}
