import type {Cents,History,RentalBookState,RentalLossVintage,RentalUnit,TaxBook} from '../model/plan';
import type {Available,Issue} from '../model/results';
import type {HouseholdTaxState} from '../model/tax-state';
import type {RentalYearFacts} from '../property/facts';
import {Decimal,settleSeries} from '../money';
import {releaseDisposedPassiveLosses} from '../tax/rental-losses';
import {sumCents} from '../tax/modified-income';
import {aggregateRuleProvenance} from '../rules/projection';
import type {YearRules} from '../rules/types';
import type {PropertyDispositionTaxFacts} from './property-disposition';
const books:readonly TaxBook[]=['federal','california','federal-amt','california-amt'];
const av=<T>(value:T):Available<T>=>({status:'available',value});
export interface DispositionBookIncome {readonly totalCents:Cents;readonly preferredCents:Cents;readonly unrecapturedCents:Cents;readonly passiveCents:Cents;readonly passiveSignedCents:Cents;readonly qbiOrdinaryByRental:Readonly<Record<string,Available<Cents>>>}
export interface PreparedRetirementDispositions {readonly opening:HouseholdTaxState;readonly income:Readonly<Record<TaxBook,Available<DispositionBookIncome>>>;readonly syntheticRentals:readonly RentalYearFacts[];readonly assumptions:readonly string[];readonly releasedCents:Readonly<Record<TaxBook,Available<Cents>>>;readonly releasedVintages:Readonly<Record<TaxBook,Readonly<Record<string,readonly RentalLossVintage[]>>>>}
/** January dispositions: apply section465 before character netting. Existing PALs have already passed465. */
export function prepareRetirementDispositions(dispositions:readonly PropertyDispositionTaxFacts[],opening:HouseholdTaxState,year:number,rules:YearRules,activeRentalIds:ReadonlySet<string>,units:readonly RentalUnit[]=[]):PreparedRetirementDispositions {
 let state=opening;const income={} as Record<TaxBook,Available<DispositionBookIncome>>,assumptions:string[]=[];
 const fail=(id:string,field:string,message:string):Readonly<{status:'needs-data';issues:readonly Issue[]}>=>({status:'needs-data',issues:[{code:'required-disposition-loss-history',recordId:id,year,field,severity:'warning',explanation:message,resolution:'Supply the allocated sale, loss character, activity or dated lookback history.'}]});
 for(const book of books){
  const errors:Issue[]=[],rentals={...state.rentals};const characterRows:{rentalId:string;recapture:Cents;section:Cents}[]=[];let section=0,recapture=0,personalCapital=0,personal1250=0,provisional1250=0,passive=0;
  const knownLookbacks=dispositions.filter(d=>d.use==='rental'&&d.holdingPeriod==='long-term').map(d=>d.lookback1231LossCents).filter((h):h is {known:true;value:Cents}=>h.known);
  if(new Set(knownLookbacks.map(h=>h.value)).size>1)errors.push(...fail('household',`lookback1231.${book}`,'Multiple property inputs disagree about the same household five-year lookback.').issues);
  for(const d of dispositions){
   const b=d.books[book];if(b.status!=='available'){errors.push(...b.issues);if(!b.issues.length)errors.push(...fail(d.propertyId,`books.${book}`,'The sale book is unavailable.').issues);continue;}
   const v=b.value,gain=sumCents([v.ordinaryRecaptureCents,v.ordinary1231Cents,v.shortTermGainCents,v.unrecaptured1250GainCents,v.longTerm1231GainCents]);let allowedLoss=v.recognizedLossCents;
   if(d.use==='rental'){
    const members=d.activityMembers.filter(m=>m.propertyId===d.propertyId);
    if(members.length!==1){errors.push(...fail(d.propertyId,`atRisk.${book}`,'Allocate the sale gain and loss to exactly one at-risk rental book per property before applying this loss worksheet.').issues);continue;}
    const id=members[0]!.rentalId,old=rentals[id]?.[book];
    if(!old||old.status!=='available'){errors.push(...(old?old.issues:fail(id,`taxHistory.${book}`,'The disposed rental has no available carried tax book.').issues));continue;}
    const s=old.value;
    if(s.lossVintages.some(v=>v.incomeCharacter)){errors.push(...fail(id,`lossVintages.${book}`,'A carried disposition loss requires its original character allocation before a later release.').issues);continue;}
    const total=sumCents([s.atRiskSuspendedCents,v.recognizedLossCents]),capacity=sumCents([s.atRiskCents,gain,-d.amountRealizedCents]);
    if(s.atRiskCents<0||capacity<0){errors.push(...fail(id,`atRisk.${book}`,'Negative at-risk capital needs a separately supported recapture worksheet.').issues);continue;}
    const allowed=Math.min(total,capacity),items=[...s.lossVintages.filter(x=>x.source==='at-risk'),...(v.recognizedLossCents?[{year,source:'at-risk' as const,amountCents:v.recognizedLossCents}]:[])],shares=settleSeries(items.map(x=>total?new Decimal(x.amountCents).times(allowed).div(total):new Decimal(0)));
    const oldItems=s.lossVintages.filter(x=>x.source==='at-risk'),released=oldItems.map((x,i)=>({...x,source:'passive' as const,amountCents:shares[i]!})).filter(x=>x.amountCents>0),remaining=oldItems.map((x,i)=>({...x,amountCents:x.amountCents-shares[i]!})).filter(x=>x.amountCents>0);
    allowedLoss=v.recognizedLossCents?shares.at(-1)??0:0;
    const suspendedSale=v.recognizedLossCents-allowedLoss;
    if((suspendedSale>0||allowedLoss>0)&&!(d.releasesEntireActivity.status==='available'&&d.releasesEntireActivity.value))errors.push(...fail(id,`dispositionLoss.${book}`,'A loss on a retained/grouped or related activity needs a character-preserving passive-disposition carry schedule.').issues);
    // Keep separately characterized current sale losses out of ScheduleE operating releases.
    if(suspendedSale>0)remaining.push({year,source:'at-risk',amountCents:suspendedSale,incomeCharacter:d.holdingPeriod==='long-term'?'section1231':'short-term'});
    const next:RentalBookState={...s,atRiskCents:capacity-allowed,atRiskSuspendedCents:total-allowed,passiveSuspendedCents:sumCents([s.passiveSuspendedCents,...released.map(x=>x.amountCents)]),lossVintages:[...s.lossVintages.filter(x=>x.source==='passive'),...released,...remaining]};
    rentals[id]={...rentals[id]!,[book]:av(next)};
    characterRows.push({rentalId:id,recapture:sumCents([v.ordinaryRecaptureCents,...(d.holdingPeriod==='short-term'?[gain-v.ordinaryRecaptureCents,-allowedLoss]:[])]),section:d.holdingPeriod==='long-term'?sumCents([gain-v.ordinaryRecaptureCents,-allowedLoss]):0});
    passive=sumCents([passive,gain,-allowedLoss]);
    recapture=sumCents([recapture,v.ordinaryRecaptureCents]);
    if(d.holdingPeriod==='long-term'){section=sumCents([section,gain-v.ordinaryRecaptureCents,-allowedLoss]);provisional1250=sumCents([provisional1250,v.unrecaptured1250BeforeLookbackCents]);}
    else recapture=sumCents([recapture,gain-v.ordinaryRecaptureCents,-allowedLoss]);
   }else {recapture=sumCents([recapture,v.ordinaryRecaptureCents,v.shortTermGainCents]);personalCapital=sumCents([personalCapital,v.longTerm1231GainCents]);personal1250=sumCents([personal1250,v.unrecaptured1250GainCents]);}
  }
  const prior=state.retirementSection1231?.[book],vintages=(prior?.lossVintages??[]).filter(v=>v.year>=year-5&&v.year<year).map(v=>({...v}));
  let undated=prior?.undatedPriorLossCents??knownLookbacks[0]?.value??0;
  if(prior&&prior.asOfYear<year&&undated>0&&section>0)errors.push(...fail('household',`lookback1231.${book}`,'Remaining entered five-year losses lack loss-year dates for this later return.').issues);
  if(!prior&&!knownLookbacks.length&&dispositions.some(d=>d.use==='rental'))assumptions.push('No prior five-year nonrecaptured section1231 loss assumed; confirm actual history.');
  const lookback=Math.min(Math.max(0,section),sumCents([undated,...vintages.map(v=>v.amountCents)]));let left=lookback;
  const take=Math.min(left,undated);undated-=take;left-=take;
  for(const v of vintages.sort((a,b)=>a.year-b.year)){const use=Math.min(left,v.amountCents);v.amountCents-=use;left-=use;}
  if(section<0)vintages.push({year,amountCents:-section});
  const U=Math.max(Math.min(provisional1250,Math.max(0,section))-lookback,0),preferred=sumCents([Math.max(0,section)-lookback-U,personalCapital]);
  const positive=characterRows.filter(r=>r.section>0),qbiOrdinaryByRental=Object.fromEntries(characterRows.map(r=>[r.rentalId,av(sumCents([r.recapture,...(section<=0?[r.section]:positive.length===1&&r.section>0?[lookback]:[])]))])) as Record<string,Available<Cents>>;
  if(section>0&&lookback>0&&positive.length>1)for(const r of positive){const q=units.find(u=>u.id===r.rentalId)?.qbi.qualification;if(q?.known&&q.value)qbiOrdinaryByRental[r.rentalId]=fail(r.rentalId,'qbi.section1231Lookback','Ordinary lookback across multiple businesses requires an entered reasonable business allocation; no pro-rata legal rule is invented.');}
  income[book]=errors.length?{status:'needs-data',issues:errors}:av({totalCents:sumCents([recapture,section,personalCapital,personal1250]),preferredCents:preferred,unrecapturedCents:sumCents([U,personal1250]),passiveCents:Math.max(0,passive),passiveSignedCents:passive,qbiOrdinaryByRental});
  state={...state,rentals,retirementSection1231:{...state.retirementSection1231,[book]:{asOfYear:year,undatedPriorLossCents:undated,lossVintages:vintages.filter(v=>v.amountCents>0)}}};
 }
 const releasedCents=Object.fromEntries(books.map(b=>[b,av(0)])) as Record<TaxBook,Available<Cents>>,releasedVintages=Object.fromEntries(books.map(b=>[b,{}])) as Record<TaxBook,Record<string,readonly RentalLossVintage[]>>;
 for(const d of dispositions){
  const released=releaseDisposedPassiveLosses(state,d);state=released.closing;
  for(const book of books){const r=released.releasedCents[book],old=releasedCents[book];
   releasedCents[book]=r.status!=='available'?r:old.status!=='available'?old:av(sumCents([old.value,r.value]));
   Object.assign(releasedVintages[book],released.releasedVintages[book]);
   const v=income[book];if(r.status!=='available')income[book]=r;else if(v.status==='available')income[book]=av({...v.value,passiveCents:Math.max(0,v.value.passiveCents-r.value)});
  }
 }
 const syntheticRentals:RentalYearFacts[]=[];
 for(const d of dispositions)for(const m of d.activityMembers.filter(m=>m.propertyId===d.propertyId&&!activeRentalIds.has(m.rentalId))){
  if(syntheticRentals.some(r=>r.rentalId===m.rentalId))continue;
  const known=<T>(value:T):History<T>=>({known:true,value});
  if(!units.some(u=>u.id===m.rentalId))assumptions.push(`No current QBI qualification assumed for disposed rental ${m.rentalId}; confirm its business status separately.`);
  const unit=units.find(u=>u.id===m.rentalId)??{id:m.rentalId,propertyId:m.propertyId,availableDate:`${year}-01-01`,rentStartDate:`${year}-01-01`,monthlyRentCents:0,rentGrowthBps:0,vacancyBps:0,activeParticipation:known(false),convertedFromPersonalUse:false,conversionBuildingFmv:known(0),loanAllocations:[],qualifications:{ordinaryResidential:known(true),longTermFairMarketLease:known(true),noPersonalUse:known(true),noSubstantialTenantServices:known(true),advancedBasisAdjustments:known(false),californiaSmallBusinessQualification:known(false)},taxHistory:Object.fromEntries(books.map(b=>[b,{known:false}])) as RentalUnit['taxHistory'],qbi:{qualification:known(false),wagesCents:known(0),ubiaCents:known(0),openingLossVintages:known([])}};
  const bookFacts=Object.fromEntries(books.map(b=>{const s=state.rentals[m.rentalId]?.[b];return [b,s?.status==='available'?av({rentalId:m.rentalId,book:b,rentCents:0,operatingExpenseCents:0,eligibleInterestCents:0,depreciationCents:0,taxableProfitCents:0,openingState:s.value,closingState:s.value}):s??fail(m.rentalId,`taxHistory.${b}`,'Missing disposed rental book.')];})) as RentalYearFacts['books'];
  const depreciation=Object.fromEntries(books.map(b=>{const s=state.rentals[m.rentalId]?.[b];return [b,s?.status==='available'?av({rentalId:m.rentalId,year,book:b,recoveryBasisCents:s.value.recoveryBasisCents,openingAdjustedBuildingBasisCents:s.value.adjustedBuildingBasisCents,depreciationCents:0,monthsRecovered:0,closing:s.value,provenance:aggregateRuleProvenance(rules,[])}):s??fail(m.rentalId,`taxHistory.${b}`,'Missing disposed rental book.')];})) as RentalYearFacts['depreciation'];
  syntheticRentals.push({rentalId:m.rentalId,propertyId:m.propertyId,unit,financingAtRiskQualification:known(true),rentCents:0,operatingExpenseCents:0,capitalExpenseCents:0,debtPaymentCents:0,cashInterestCents:0,principalPaidCents:0,cashFlowCents:0,eligibleInterestCents:av(0),depreciation,books:bookFacts});
 }
 return {opening:state,income,syntheticRentals,releasedCents,releasedVintages,assumptions:[...new Set(assumptions)]};
}
