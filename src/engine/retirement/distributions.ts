import {resolveDistributionAccess} from './required-distributions';
import type {Cents,History,ISODate} from '../model/plan';
import type {Available,Issue} from '../model/results';
import type {HouseholdTaxState,RetirementIraBasis,RetirementRothHistory} from '../model/tax-state';
import type {YearRules} from '../rules/types';
import {Decimal,MAX_CENTS,settleCents,settleSeries} from '../money';
import {calendarDate,isValidISODate} from '../dates';
import type {DistributionAccountState,ProposedDistributionLeg} from './account-ledger';
export type WithdrawalStrategyId='taxable-first'|'traditional-first'|'roth-first'|'annual-tax-aware';
export interface AcceptedDistributionSchedule {readonly year:number;readonly legs:readonly (ProposedDistributionLeg & {readonly acceptedGrossCents:Cents;readonly shortfallCents:Cents})[]}
export interface DistributionYearInput {readonly year:number;readonly rules:YearRules;readonly openingAccounts:readonly DistributionAccountState[];readonly proposedLegs:readonly ProposedDistributionLeg[];readonly openingTaxState:HouseholdTaxState;readonly iraBasisByOwner:Readonly<Record<string,RetirementIraBasis>>;readonly yearEndIraValuesByOwner:Readonly<Record<string,Available<Cents>>>;readonly ownerBirthDates:Readonly<Record<string,History<ISODate>>>;readonly separationDatesByAccount?:Readonly<Record<string,History<ISODate>>>}
export interface RetirementDistributionTaxFacts {readonly eventId:string;readonly accountId:string;readonly ownerId:string;readonly date:string;readonly purpose:ProposedDistributionLeg['purpose'];readonly incomeCharacter:'long-term-gain'|'ordinary'|'roth';readonly grossCents:Available<Cents>;readonly federalTaxableCents:Available<Cents>;readonly californiaTaxableCents:Available<Cents>;readonly basisRecoveredCents:Available<Cents>;readonly californiaBasisRecoveredCents:Available<Cents>;readonly basisConsumedCents:Available<Cents>;readonly realizedGainCents:Available<Cents>;readonly additionalFederalTaxCents:Available<Cents>;readonly additionalCaliforniaTaxCents:Available<Cents>;readonly rmdEligibleCents:Available<Cents>;readonly estimated:boolean}
export interface DistributionYearResult {readonly acceptedSchedule:AcceptedDistributionSchedule;readonly closingAccounts:readonly DistributionAccountState[];readonly closingTaxState:HouseholdTaxState;readonly taxFacts:readonly RetirementDistributionTaxFacts[];readonly issues:readonly Issue[];readonly assumptions:readonly string[]}
const av=<T>(value:T):Available<T>=>({status:'available',value});
const sum=(values:readonly number[])=>settleCents(values.reduce((n,v)=>n.plus(v),new Decimal(0)));
/** Resolve accepted gross legs once, then allocate owner-wide basis to that fixed schedule. */
export function resolveRetirementDistributions(input:DistributionYearInput):DistributionYearResult {
 if(input.rules.year!==input.year)throw new RangeError('Distribution rule year mismatch.');
 const accounts=new Map(input.openingAccounts.map(a=>[a.accountId,{...a}])),issues:Issue[]=[],assumptions:string[]=[],legs:AcceptedDistributionSchedule['legs'][number][]=[],taxFacts:RetirementDistributionTaxFacts[]=[];
 const seen=new Set<string>(),balanceBeforeByEvent=new Map<string,Cents>();
 const problem=(recordId:string,field:string,explanation:string,code='required-distribution-history'):Available<never>=>{const issue:Issue={code,recordId,field,year:input.year,severity:'warning',explanation,resolution:'Review the account, owner history and accepted distribution schedule.'};issues.push(issue);return {status:'needs-data',issues:[issue]};};
 const brokerage=new Map<string,{basisConsumedCents:number;gainCents:number;californiaConsumedCents:number;californiaGainCents:number;estimated:boolean}>();
 for(const leg of [...input.proposedLegs].sort((a,b)=>a.date.localeCompare(b.date)||a.eventId.localeCompare(b.eventId)||a.accountId.localeCompare(b.accountId))){
  if(seen.has(leg.eventId)){problem(leg.accountId,'eventId','A distribution event may be accepted only once.','duplicate-distribution-event');continue;}seen.add(leg.eventId);
  const account=accounts.get(leg.accountId);
  if(!account||!isValidISODate(leg.date)||Number(leg.date.slice(0,4))!==input.year||!Number.isSafeInteger(leg.grossCents)||leg.grossCents<0||leg.grossCents>MAX_CENTS){problem(leg.accountId,'grossCents','The requested account, date or gross amount is invalid.');continue;}
  const exact=new Decimal(account.balanceExact),available=Math.max(0,settleCents(exact.floor())),gross=Math.min(available,leg.grossCents),full=gross>0&&gross===available;
  legs.push({...leg,acceptedGrossCents:gross,shortfallCents:leg.grossCents-gross});balanceBeforeByEvent.set(leg.eventId,settleCents(exact));
  if(account.type==='taxable-brokerage'||account.type==='rsu'||account.type==='traditional-401k'){
   const estimated=!account.basis.known||!!account.californiaBasis&&!account.californiaBasis.known,basis=account.basis.known?account.basis.value:account.estimatedBasisCents??0;
   const consumed=gross===0?0:full?basis:Math.min(basis,settleCents(new Decimal(basis).times(gross).div(exact)));
   const caBasis=account.californiaBasis?.known?account.californiaBasis.value:account.estimatedCaliforniaBasisCents??basis,caConsumed=gross===0?0:full?caBasis:Math.min(caBasis,settleCents(new Decimal(caBasis).times(gross).div(exact)));
   brokerage.set(leg.eventId,{basisConsumedCents:consumed,gainCents:gross-consumed,californiaConsumedCents:caConsumed,californiaGainCents:gross-caConsumed,estimated});
   accounts.set(account.accountId,{...account,balanceExact:full?'0':exact.minus(gross).toString(),basis:account.basis.known?{known:true,value:basis-consumed}:{known:false},...(!account.basis.known?{estimatedBasisCents:basis-consumed}:{}),...(account.californiaBasis?{californiaBasis:account.californiaBasis.known?{known:true,value:caBasis-caConsumed}:{known:false},...(!account.californiaBasis.known?{estimatedCaliforniaBasisCents:caBasis-caConsumed}:{})}:{})});
   if(estimated)assumptions.push(`Account ${account.accountId}: unanswered brokerage basis uses the explicit estimate or conservative zero basis; saved history remains unknown.`);
  }else accounts.set(account.accountId,{...account,balanceExact:full?'0':exact.minus(gross).toString()});
 }
 const ownerBasis={...input.openingTaxState.retirementAccountState?.iraBasisByOwner,...input.iraBasisByOwner},recovered=new Map<string,{federal:Available<Cents>;california:Available<Cents>;estimated:boolean}>();
 for(const ownerId of [...new Set(legs.filter(l=>accounts.get(l.accountId)!.type==='traditional-ira').map(l=>accounts.get(l.accountId)!.ownerId))].sort()){
  const ownerLegs=legs.filter(l=>{const a=accounts.get(l.accountId)!;return a.type==='traditional-ira'&&a.ownerId===ownerId;}),gross=sum(ownerLegs.map(l=>l.acceptedGrossCents));
  const prior=ownerBasis[ownerId]??{federal:input.openingTaxState.iraBasisByOwner[ownerId]??{known:false},california:input.openingTaxState.iraBasisByOwner[ownerId]??{known:false}};
  const end=input.yearEndIraValuesByOwner[ownerId],amounts={} as Record<'federal'|'california',Available<Cents>>,closing={} as Record<'federal'|'california',History<Cents>>;
  for(const jurisdiction of ['federal','california'] as const){const history=prior[jurisdiction],basis=history.known?history.value:0;
   const amount=input.rules.retirement.distributions.iraProRataMethod!=='owner-year-end-aggregate'?problem(ownerId,'rules.distributions.iraProRataMethod','The supplied IRA basis rule is unsupported.'):basis===0||gross===0?av(0):!end?problem(ownerId,'yearEndIraValuesByOwner','Owner-wide pro-rata basis needs the accepted year-end value of every traditional/SEP/SIMPLE IRA.'):end.status!=='available'?end:!Number.isSafeInteger(end.value)||end.value<0||end.value>MAX_CENTS?problem(ownerId,'yearEndIraValuesByOwner','The accepted year-end IRA value must be supported nonnegative integer cents.'):av(settleCents(Decimal.min(basis,new Decimal(basis).times(gross).div(new Decimal(end.value).plus(gross)))));
   amounts[jurisdiction]=amount;closing[jurisdiction]=history.known&&amount.status==='available'?{known:true,value:basis-amount.value}:{known:false};
   if(!history.known)assumptions.push(`Owner ${ownerId}: no recoverable ${jurisdiction} nondeductible IRA basis assumed until reviewed.`);
  }
  let californiaPre1987Basis=prior.californiaPre1987Basis;
  if(californiaPre1987Basis?.known&&californiaPre1987Basis.value>0){
   if(!prior.federal.known||!prior.california.known||prior.federal.value!==prior.california.value){amounts.california=problem(ownerId,'californiaPre1987Basis','Positive pre1987 California-only basis combined with unequal post1986/federal basis requires a separately supported ordinary-distribution worksheet.','unsupported-california-ira-history');closing.california={known:false};californiaPre1987Basis={known:false};}
   else if(amounts.california.status==='available'){const extra=Math.min(californiaPre1987Basis.value,gross-amounts.california.value);amounts.california=av(amounts.california.value+extra);californiaPre1987Basis={known:true,value:californiaPre1987Basis.value-extra};}
  }else if(!californiaPre1987Basis?.known)assumptions.push(`Owner ${ownerId}: no pre1987 California-only IRA basis assumed until reviewed.`);
  ownerBasis[ownerId]={...prior,...closing,...(californiaPre1987Basis?{californiaPre1987Basis}:{})};
  const fed=amounts.federal,ca=amounts.california,split=(v:Available<Cents>):readonly Available<Cents>[]=>v.status==='available'?settleSeries(ownerLegs.map(l=>gross?new Decimal(v.value).times(l.acceptedGrossCents).div(gross):new Decimal(0))).map(av):ownerLegs.map(()=>v),f=split(fed),c=split(ca);
  ownerLegs.forEach((l,i)=>recovered.set(l.eventId,{federal:f[i]!,california:c[i]!,estimated:!prior.federal.known||!prior.california.known}));
 }
 const rothByAccount:Record<string,RetirementRothHistory>={...input.openingTaxState.retirementAccountState?.rothByAccount};
 const emptyRoth=():RetirementRothHistory=>({contributionBasis:{known:false},firstContributionYear:{known:false},conversionLayers:[]});
 for(const leg of legs){const account=accounts.get(leg.accountId)!,gross=leg.acceptedGrossCents,taxable=(recovery:Available<Cents>):Available<Cents>=>recovery.status==='available'?av(gross-recovery.value):recovery;
  let federal:Available<Cents>,california:Available<Cents>,basisRecovered:Available<Cents>=av(0),caRecovered:Available<Cents>=av(0),consumed:Available<Cents>=av(0),gain:Available<Cents>=av(0),estimated=false;
  const taxableAccount=account.type==='taxable-brokerage'||account.type==='rsu';
  if(taxableAccount||account.type==='traditional-401k'){const b=brokerage.get(leg.eventId)!;consumed=av(b.basisConsumedCents);basisRecovered=av(Math.min(gross,b.basisConsumedCents));caRecovered=av(Math.min(gross,b.californiaConsumedCents));gain=av(taxableAccount?b.gainCents:0);federal=av(Math.max(0,b.gainCents));california=av(Math.max(0,b.californiaGainCents));estimated=b.estimated;}
  else if(account.type==='traditional-ira'){const r=recovered.get(leg.eventId)!;basisRecovered=r.federal;caRecovered=r.california;federal=taxable(basisRecovered);california=taxable(caRecovered);estimated=r.estimated;}
  else {federal=av(gross);california=federal;}
  const retirement=account.type==='traditional-ira'||account.type==='traditional-401k';
  let additionalFederal:Available<Cents>=av(0),additionalCalifornia:Available<Cents>=av(0);
  if(!taxableAccount){
   let rothHistory=rothByAccount[account.accountId],rothHistoryEstimated=false;
   const ownerRoths=[...accounts.values()].filter(a=>a.type==='roth-ira'&&a.ownerId===account.ownerId).sort((a,b)=>a.accountId.localeCompare(b.accountId));
   const origins:{accountId:string;index:number;year:number}[]=[];
   if(account.type==='roth-ira'){
    const histories=ownerRoths.map(a=>rothByAccount[a.accountId]??emptyRoth()),knownYears=histories.flatMap(h=>h.firstContributionYear.known?[h.firstContributionYear.value]:[]),first=knownYears.length?Math.min(...knownYears):undefined;
    rothHistoryEstimated=histories.some(h=>!h.contributionBasis.known);
    const layers=ownerRoths.flatMap(a=>(rothByAccount[a.accountId]??emptyRoth()).conversionLayers.map((layer,index)=>({accountId:a.accountId,index,layer}))).sort((a,b)=>a.layer.year-b.layer.year||a.accountId.localeCompare(b.accountId)||a.index-b.index);
    layers.forEach(l=>origins.push({accountId:l.accountId,index:l.index,year:l.layer.year}));
    rothHistory={contributionBasis:{known:true,value:sum(histories.map(h=>h.contributionBasis.known?h.contributionBasis.value:0))},firstContributionYear:first!==undefined&&(histories.every(h=>h.firstContributionYear.known)||input.year>=first+input.rules.retirement.distributions.rothQualificationYears)?{known:true,value:first}:{known:false},conversionLayers:layers.map(l=>l.layer)};
   }
   const result=resolveDistributionAccess({accountId:account.accountId,ownerId:account.ownerId,accountKind:account.type,date:leg.date,birthDate:input.ownerBirthDates[account.ownerId]??{known:false},grossCents:gross,federalTaxableCents:federal,californiaTaxableCents:california,rules:input.rules,accountBalanceCents:balanceBeforeByEvent.get(leg.eventId)!,basis:account.basis,...(account.californiaBasis?{californiaBasis:account.californiaBasis}:{}),...(input.separationDatesByAccount?.[account.accountId]?{separationDate:input.separationDatesByAccount[account.accountId]!}:{}),...(rothHistory?{rothHistory,rothHistoryEstimated}:{})});
   if(result.status!=='available'){additionalFederal=result;additionalCalifornia=result;if(account.type==='roth-ira'||account.type==='roth-401k'){federal=result;california=result;}issues.push(...result.issues);}
   else {
    const access=result.value;federal=access.federalTaxableCents;california=access.californiaTaxableCents;additionalFederal=access.additionalFederalTaxCents;additionalCalifornia=access.additionalCaliforniaTaxCents;estimated ||=access.estimated;assumptions.push(...access.assumptions);
    if(account.type==='roth-ira'||account.type==='roth-401k'){basisRecovered=access.basisRecoveredCents;caRecovered=access.californiaBasisRecoveredCents;}
    if(access.closingRothHistory){
     if(account.type==='roth-ira'&&rothHistory){
      let consumed=rothHistory.contributionBasis.known&&access.closingRothHistory.contributionBasis.known?rothHistory.contributionBasis.value-access.closingRothHistory.contributionBasis.value:0;
      for(const a of ownerRoths){const h=rothByAccount[a.accountId]??emptyRoth(),used=h.contributionBasis.known?Math.min(consumed,h.contributionBasis.value):0;consumed-=used;rothByAccount[a.accountId]={...h,contributionBasis:h.contributionBasis.known?{known:true,value:h.contributionBasis.value-used}:h.contributionBasis,conversionLayers:[...h.conversionLayers]};}
      access.closingRothHistory.conversionLayers.forEach((layer,index)=>{const origin=origins[index]!;const h=rothByAccount[origin.accountId]!,layers=[...h.conversionLayers];layers[origin.index]=layer;rothByAccount[origin.accountId]={...h,conversionLayers:layers};});
     }else {rothByAccount[account.accountId]=access.closingRothHistory;accounts.set(account.accountId,{...accounts.get(account.accountId)!,basis:account.basis.known&&basisRecovered.status==='available'?{known:true,value:account.basis.value-basisRecovered.value}:account.basis,...(account.californiaBasis?{californiaBasis:account.californiaBasis.known&&caRecovered.status==='available'?{known:true,value:account.californiaBasis.value-caRecovered.value}:account.californiaBasis}:{})});}
    }
   }
  }
  taxFacts.push({eventId:leg.eventId,accountId:account.accountId,ownerId:account.ownerId,date:leg.date,purpose:leg.purpose,incomeCharacter:taxableAccount?'long-term-gain':retirement?'ordinary':'roth',grossCents:av(gross),federalTaxableCents:federal,californiaTaxableCents:california,basisRecoveredCents:basisRecovered,californiaBasisRecoveredCents:caRecovered,basisConsumedCents:consumed,realizedGainCents:gain,additionalFederalTaxCents:additionalFederal,additionalCaliforniaTaxCents:additionalCalifornia,rmdEligibleCents:av(retirement?gross:0),estimated});
 }
 const iraBasisByOwner={...input.openingTaxState.iraBasisByOwner,...Object.fromEntries(Object.entries(ownerBasis).map(([id,b])=>[id,b.federal]))};
 return {acceptedSchedule:{year:input.year,legs},closingAccounts:[...accounts.values()].sort((a,b)=>a.accountId.localeCompare(b.accountId)),closingTaxState:{...input.openingTaxState,year:input.year,iraBasisByOwner,retirementAccountState:{iraBasisByOwner:ownerBasis,rothByAccount}},taxFacts,issues:[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()],assumptions:[...new Set(assumptions)]};
}
