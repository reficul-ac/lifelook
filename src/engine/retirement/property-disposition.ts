import type {Cents,History,TaxBook} from '../model/plan';
import type {Available} from '../model/results';
import {CalculationRangeError,Decimal,MAX_CENTS,settleCents} from '../money';
import {isValidISODate} from '../dates';
import {loadRuleSet} from '../rules/registry';
type HistoryOrigin='entered-history'|'estimate'|'unknown';
export interface PropertyDispositionBookInput {readonly basisOrigin?:'entered-history'|'estimate';readonly depreciationOrigin?:'entered-history'|'estimate';readonly adjustedBasisCents:Cents;readonly lossBasisCents?:Cents;readonly depreciationCents:Cents;readonly additionalDepreciationCents:Cents;readonly disposalDepreciationCents:Cents}
export interface PropertyDispositionInput {
 readonly ownershipUseOrigin?:'entered-history'|'estimate';readonly eventId:string;readonly propertyId:string;readonly activityId:string;readonly date:string;readonly use:'personal'|'rental';readonly dispositionType:'whole'|'exchange'|'installment'|'partial'|'reduced-exclusion';readonly holdingPeriod:'long-term'|'short-term';readonly grossPriceCents:Cents;readonly sellingCostsCents:Cents;readonly settlementPrincipalCents:Cents;
 readonly homeExclusionEligible:History<boolean>;readonly unrelatedBuyer:History<boolean>;readonly lookback1231LossCents:History<Cents>;readonly activityMembers:readonly {readonly rentalId:string;readonly propertyId:string}[];readonly disposedPropertyIds:readonly string[];readonly books:Readonly<Record<TaxBook,Available<PropertyDispositionBookInput>>>;
}
export interface PropertyDispositionBookFacts {readonly gainCents:Cents;readonly adjustedBasisAtSaleCents:Cents;readonly disposalDepreciationCents:Cents;readonly ordinaryRecaptureCents:Cents;readonly ordinary1231Cents:Cents;readonly shortTermGainCents:Cents;readonly unrecaptured1250GainCents:Cents;readonly longTerm1231GainCents:Cents;readonly recognizedLossCents:Cents;readonly nonDeductiblePersonalLossCents:Cents;readonly excluded121GainCents:Cents;readonly passiveDispositionIncomeCents:Cents}
export interface PropertyDispositionTaxFacts {readonly eventId:string;readonly propertyId:string;readonly activityId:string;readonly purpose:'transition';readonly activityMembers:PropertyDispositionInput['activityMembers'];readonly disposedPropertyIds:readonly string[];readonly books:Readonly<Record<TaxBook,Available<PropertyDispositionBookFacts>>>;readonly releasesEntireActivity:Available<boolean>}
export interface PropertyDispositionResult {readonly taxFacts:PropertyDispositionTaxFacts;readonly provenance:{readonly ruleVersion:string;readonly sources:readonly string[];readonly assumptions:readonly string[];readonly ownershipUseOrigin:HistoryOrigin;readonly basisOriginByBook:Readonly<Record<TaxBook,HistoryOrigin>>;readonly depreciationOriginByBook:Readonly<Record<TaxBook,HistoryOrigin>>}}
const av=<T>(value:T):Available<T>=>({status:'available',value});
const books:readonly TaxBook[]=['federal','california','federal-amt','california-amt'];
const money=(v:number)=>Number.isSafeInteger(v)&&v>=0&&v<=MAX_CENTS;
function failure(input:PropertyDispositionInput,field:string,explanation:string,status:'needs-data'|'unsupported-case'='unsupported-case'):Available<never>{return {status,issues:[{code:'unsupported-property-disposition',recordId:input.propertyId,field,severity:'warning',explanation,resolution:'Supply supported whole-property disposition, historical basis and activity facts.'}]};}
/** Characterize fixed sale facts. Mortgage cash settlement never changes taxable gain. */
export function calculatePropertyDisposition(input:PropertyDispositionInput):Available<PropertyDispositionResult>{
 if(input.dispositionType!=='whole')return failure(input,'dispositionType','This disposition needs an exceptional transaction or reduced-exclusion worksheet.');
 if(!isValidISODate(input.date)||!money(input.grossPriceCents)||!money(input.sellingCostsCents)||!money(input.settlementPrincipalCents))return failure(input,'salePriceCents','A valid date and supported sale/settlement amounts are required.','needs-data');
 const assumptions:string[]=[];
 if(!input.homeExclusionEligible.known&&input.use==='personal')assumptions.push('No home-sale exclusion assumed because eligibility is unanswered.');
 if(!input.lookback1231LossCents.known&&input.use==='rental')assumptions.push('No prior five-year nonrecaptured section1231 loss assumed; confirm actual history.');
 const maximum=loadRuleSet().federal.values['propertyDisposition.homeExclusionMaximumCents']?.value;
 if(typeof maximum!=='number')return failure(input,'homeExclusionMaximumCents','No sourced section121 exclusion rule is available.');
 const net=new Decimal(input.grossPriceCents).minus(input.sellingCostsCents);
 const resolved=Object.fromEntries(books.map(book=>{
  const value=input.books[book];if(value.status!=='available')return [book,value];const b=value.value;
  if(![b.adjustedBasisCents,b.lossBasisCents??b.adjustedBasisCents,b.depreciationCents,b.additionalDepreciationCents,b.disposalDepreciationCents].every(money)||b.disposalDepreciationCents>b.adjustedBasisCents)return [book,failure(input,`books.${book}`,'The adjusted basis and depreciation history are invalid.','needs-data')];
  try{
   const adjustedBasisAtSaleCents=settleCents(new Decimal(b.adjustedBasisCents).minus(b.disposalDepreciationCents)),lossBasis=settleCents(new Decimal(b.lossBasisCents??b.adjustedBasisCents).minus(b.disposalDepreciationCents));
   if(lossBasis<0||lossBasis>adjustedBasisAtSaleCents)return [book,failure(input,`books.${book}.lossBasisCents`,'Conversion loss basis must be nonnegative and cannot exceed the historical gain basis.','needs-data')];
   const gainCents=Math.max(0,settleCents(net.minus(adjustedBasisAtSaleCents))),loss=Math.max(0,settleCents(new Decimal(lossBasis).minus(net))),totalDep=settleCents(new Decimal(b.depreciationCents).plus(b.disposalDepreciationCents));
   if(loss>0&&input.use==='rental'&&(!input.unrelatedBuyer.known||!input.unrelatedBuyer.value))return [book,failure(input,`books.${book}.recognizedLossCents`,'A related-party or unconfirmed buyer requires separately supported loss treatment.','needs-data')];
   if(b.additionalDepreciationCents>totalDep)return [book,failure(input,`books.${book}.additionalDepreciationCents`,'Additional depreciation cannot exceed total allowed/allowable depreciation.','needs-data')];
   const ordinaryRecaptureCents=Math.min(gainCents,input.holdingPeriod==='short-term'?totalDep:b.additionalDepreciationCents),excluded121GainCents=input.homeExclusionEligible.known&&input.homeExclusionEligible.value?Math.min(maximum,Math.max(0,gainCents-totalDep)):0;
   const recognizedGain=gainCents-ordinaryRecaptureCents-excluded121GainCents;
   const lookback=input.lookback1231LossCents.known?input.lookback1231LossCents.value:0;
   if(!money(lookback))return [book,failure(input,'lookback1231LossCents','Enter supported nonrecaptured prior section1231 losses.','needs-data')];
   const ordinary1231Cents=input.use==='rental'&&input.holdingPeriod==='long-term'?Math.min(recognizedGain,lookback):0,shortTermGainCents=input.holdingPeriod==='short-term'?recognizedGain:0,capital=recognizedGain-ordinary1231Cents-shortTermGainCents;
   const unrecaptured1250GainCents=Math.min(capital,Math.max(0,totalDep-ordinaryRecaptureCents)),longTerm1231GainCents=capital-unrecaptured1250GainCents;
   const facts:PropertyDispositionBookFacts={gainCents,adjustedBasisAtSaleCents,disposalDepreciationCents:b.disposalDepreciationCents,ordinaryRecaptureCents,ordinary1231Cents,shortTermGainCents,unrecaptured1250GainCents,longTerm1231GainCents,recognizedLossCents:input.use==='rental'?loss:0,nonDeductiblePersonalLossCents:input.use==='personal'?loss:0,excluded121GainCents,passiveDispositionIncomeCents:input.use==='rental'?gainCents-excluded121GainCents:0};
   return [book,av(facts)];
  }catch(e){if(!(e instanceof CalculationRangeError))throw e;return [book,failure(input,`books.${book}`,'This disposition amount exceeds the supported monetary range.')];}
 })) as Record<TaxBook,Available<PropertyDispositionBookFacts>>;
 const whole=input.activityMembers.length>0&&input.activityMembers.every(m=>input.disposedPropertyIds.includes(m.propertyId));
 const excluded=Object.values(resolved).some(b=>b.status==='available'&&b.value.excluded121GainCents>0);
 const releasesEntireActivity:Available<boolean>=input.use!=='rental'||!whole?av(false):excluded?failure(input,'releasesEntireActivity','An excluded home gain combined with rental suspended losses needs a separately supported release worksheet.'):!input.unrelatedBuyer.known?failure(input,'unrelatedBuyer','Full activity release requires a confirmed unrelated taxable disposition.','needs-data'):av(input.unrelatedBuyer.value);
 return av({taxFacts:{eventId:input.eventId,propertyId:input.propertyId,activityId:input.activityId,purpose:'transition',activityMembers:input.activityMembers,disposedPropertyIds:input.disposedPropertyIds,books:resolved,releasesEntireActivity},provenance:{ownershipUseOrigin:input.ownershipUseOrigin??'entered-history',basisOriginByBook:Object.fromEntries(books.map(b=>{const v=input.books[b];return [b,v.status==='available'?v.value.basisOrigin??'entered-history':'unknown'];})) as Record<TaxBook,HistoryOrigin>,depreciationOriginByBook:Object.fromEntries(books.map(b=>{const v=input.books[b];return [b,v.status==='available'?v.value.depreciationOrigin??'entered-history':'unknown'];})) as Record<TaxBook,HistoryOrigin>,ruleVersion:'retirement-property-disposition.1',sources:['https://www.irs.gov/publications/p523','https://www.irs.gov/publications/p544','https://www.irs.gov/publications/p925','https://www.irs.gov/publications/p527'],assumptions}});
}
