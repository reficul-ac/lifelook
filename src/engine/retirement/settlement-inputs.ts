import type {Account,Cents,History,RentalUnit,TaxBook,ValidatedPlan} from '../model/plan';
import type {Available} from '../model/results';
import type {ForecastCheckpoint} from '../forecast/types';
import type {RetirementSnapshot} from './snapshot';
import type {DistributionAccountState} from './account-ledger';
import {Decimal,settleCents} from '../money';
import {combineAvailableCents,sumCents} from '../tax/modified-income';
import {calculatePropertyDisposition,type PropertyDispositionTaxFacts,type PropertyDispositionBookInput} from './property-disposition';
import {calculateDepreciation} from '../property/depreciation';
import type {PropertyTransitionEvent} from './property-transition';
import type {YearRules} from '../rules/types';
const av=<T>(value:T):Available<T>=>({status:'available',value});
const books:readonly TaxBook[]=['federal','california','federal-amt','california-amt'];
export function retirementAccountInventory(snapshot:RetirementSnapshot,opening:ForecastCheckpoint,plan:ValidatedPlan):readonly Account[] {
 const base=opening.retirementAccounts??plan.accounts,common=snapshot.definition.stockGrowthBps;
 const accounts=base.map(a=>{if(common===undefined||a.type==='rsu')return a;const {growthSource:_,...value}=a;return {...value,annualGrowthBps:common};});
 if(accounts.some(a=>a.type==='taxable-brokerage'))return accounts;
 let id='retirement:taxable',suffix=1;const ids=new Set([...plan.accounts.map(a=>a.id),...plan.properties.map(p=>p.id),...snapshot.definition.newProperties.map(p=>p.id)]);while(ids.has(id))id=`retirement:taxable:${suffix++}`;
 return [...accounts,{id,name:'Retirement taxable stocks',ownerId:plan.household.filers[0].id,type:'taxable-brokerage',openingBalanceCents:0,openingIraBasis:{known:true,value:0},openingTaxableBasis:{known:true,value:0},annualGrowthBps:common??plan.growthAssumptions?.stocksBps??0}];
}
export function retirementOpeningAccounts(snapshot:RetirementSnapshot,opening:ForecastCheckpoint,accounts:readonly Account[]):Available<readonly DistributionAccountState[]> {
 const values:Available<DistributionAccountState>[]=accounts.map(a=>{
  const carried=opening.retirementAccountBalances?.find(c=>c.accountId===a.id);if(carried)return av(carried);
  const balance=opening.accountExact[a.id]??av(String(a.openingBalanceCents));if(balance.status!=='available')return balance;
  const override=snapshot.definition.assumptions.accounts.find(o=>o.accountId===a.id),sourceKnown=opening.brokerageBasisHistory[a.id]?.known;
  let basis:History<Cents>=a.type==='taxable-brokerage'?opening.brokerageBasisHistory[a.id]??{known:false}:a.type==='traditional-401k'||a.type==='roth-401k'?{known:false}:{known:true,value:0},estimate=0;
  if(a.type==='taxable-brokerage'){
   const b=opening.brokerageBasis[a.id];if(b&&b.status!=='available')return b;
   const amount=b?.status==='available'?b.value:0;
   if(sourceKnown)basis={known:true,value:amount};else {estimate=sumCents([amount,override?.taxableBasisCents?.known?override.taxableBasisCents.value:0]);basis={known:false};}
   if(!snapshot.context.source.accounts.some(s=>s.id===a.id))basis={known:true,value:0};
  }
  if(a.type==='rsu'){
   const state=opening.rsuState[a.id];if(state&&state.status!=='available')return state;
   const layers=state?.status==='available'?state.value:[],known=layers.every(s=>s.basisExact!==undefined),amount=settleCents(layers.reduce((n,s)=>n.plus(s.basisExact??s.estimatedBasisExact??0),new Decimal(0)));
   basis=known?{known:true,value:amount}:{known:false};estimate=known?0:sumCents([amount,override?.taxableBasisCents?.known?override.taxableBasisCents.value:0]);
  }
  if((a.type==='traditional-401k'||a.type==='roth-401k')&&override?.taxableBasisCents?.known)basis=override.taxableBasisCents;
  const californiaBasis=override?.californiaBasisCents??basis;
  return av({accountId:a.id,ownerId:a.ownerId,type:a.type,balanceExact:balance.value,basis,...(!basis.known?{estimatedBasisCents:estimate}:{}),californiaBasis,...(!californiaBasis.known?{estimatedCaliforniaBasisCents:estimate}:{})});
 });
 const missing=values.filter(v=>v.status!=='available');return missing.length?{status:missing.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:missing.flatMap(v=>v.issues)}:av(values.map(v=>{if(v.status!=='available')throw Error('account');return v.value;}));
}
/** Characterize January sales from the pre-disposition books, independently of mortgage cash settlement. */
export function retirementSaleFacts(snapshot:RetirementSnapshot,opening:ForecastCheckpoint,events:readonly PropertyTransitionEvent[],rules:YearRules):readonly PropertyDispositionTaxFacts[] {
 const results:PropertyDispositionTaxFacts[]=[];
 for(const event of events.filter((e):e is Extract<PropertyTransitionEvent,{kind:'sale'}>=>e.kind==='sale')){
  const p=snapshot.context.plan.properties.find(p=>p.id===event.propertyId)!,units=snapshot.context.plan.rentals.filter(r=>r.propertyId===p.id),assumption=snapshot.definition.assumptions.properties.find(a=>a.propertyId===p.id),share=assumption?.buildingShareBps??snapshot.definition.assumptions.buildingShareBps;
  const missing=(field:string):Available<never>=>({status:'needs-data',issues:[{code:'required-retirement-sale-history',recordId:p.id,field,year:opening.year,severity:'warning',explanation:'The affected sale needs its allocated historical tax basis and activity book.',resolution:'Review the property sale assumptions and carried history.'}]});
  const byBook=Object.fromEntries(books.map(book=>{
   const adjusted=assumption?.adjustedBasisByBook?.[book],prior=assumption?.priorDepreciationByBook?.[book],unit=units[0];
   if(units.length>1||p.role==='primary-with-adu')return [book,missing(`saleAllocation.${book}`)];
   if(!unit){const dep=prior?.known?prior.value:0,basis=adjusted?.known?adjusted.value:sumCents([p.purchasePriceCents,assumption?.improvementsCents?.known?assumption.improvementsCents.value:0,-dep]);return [book,adjusted&&!adjusted.known?missing(`adjustedBasisByBook.${book}`):av({adjustedBasisCents:basis,depreciationCents:dep,additionalDepreciationCents:0,disposalDepreciationCents:0,basisOrigin:adjusted?.known?'entered-history':'estimate',depreciationOrigin:prior?.known?'entered-history':'estimate'})];}
   const state=opening.taxState.rentals[unit.id]?.[book];if(!state||state.status!=='available')return [book,state??missing(`taxHistory.${book}`)];
   const dep=calculateDepreciation(unit,opening.year,book,state,rules,{disposalDate:event.date});if(dep.status!=='available')return [book,dep];
   const land=settleCents(new Decimal(p.purchasePriceCents).times(10000-share).div(10000)),gainHistory=opening.taxState.retirementPropertyHistory?.gainBuildingBasisByRental[unit.id]?.[book];
   const historical=gainHistory?.status==='available'?Math.max(0,gainHistory.value-state.value.cumulativeDepreciationCents):state.value.adjustedBuildingBasisCents;
   const buildingGain=event.grossProceedsCents.status==='available'&&event.sellingCostsCents.status==='available'?Math.max(0,settleCents(new Decimal(event.grossProceedsCents.value-event.sellingCostsCents.value).times(share).div(10000).minus(historical).plus(dep.value.depreciationCents))):0;
   return [book,av({adjustedBasisCents:sumCents([historical,land]),lossBasisCents:sumCents([state.value.adjustedBuildingBasisCents,land]),depreciationCents:state.value.cumulativeDepreciationCents,additionalDepreciationCents:0,disposalDepreciationCents:dep.value.depreciationCents,buildingGainCents:buildingGain,basisOrigin:'entered-history',depreciationOrigin:'entered-history'})];
  })) as Record<TaxBook,Available<PropertyDispositionBookInput>>;
  const cash=combineAvailableCents([event.grossProceedsCents,event.sellingCostsCents,event.liabilityCents]);
  const members=units.map(r=>({rentalId:r.id,propertyId:r.propertyId})),gross=event.grossProceedsCents.status==='available'?event.grossProceedsCents.value:0,cost=event.sellingCostsCents.status==='available'?event.sellingCostsCents.value:0;
  const result=calculatePropertyDisposition({eventId:event.id,propertyId:p.id,activityId:assumption?.activityId??units[0]?.id??p.id,date:event.date,use:units.length?'rental':'personal',dispositionType:'whole',holdingPeriod:p.purchaseDate<`${opening.year-1}-01-01`?'long-term':'short-term',grossPriceCents:gross,sellingCostsCents:cost,settlementPrincipalCents:event.liabilityCents.status==='available'?-event.liabilityCents.value:0,homeExclusionEligible:assumption?.homeExclusionEligible??{known:false},unrelatedBuyer:{known:true,value:true},lookback1231LossCents:assumption?.zero1231Lookback?.known&&assumption.zero1231Lookback.value?{known:true,value:0}:{known:false},activityMembers:members,disposedPropertyIds:events.filter(e=>e.kind==='sale').map(e=>e.propertyId),books:cash.status==='available'?byBook:Object.fromEntries(books.map(b=>[b,cash])) as typeof byBook});
  if(result.status==='available')results.push(result.value.taxFacts);else results.push({eventId:event.id,propertyId:p.id,activityId:p.id,purpose:'transition',amountRealizedCents:0,use:units.length?'rental':'personal',holdingPeriod:'long-term',lookback1231LossCents:{known:false},activityMembers:members,disposedPropertyIds:[p.id],books:Object.fromEntries(books.map(b=>[b,result])) as PropertyDispositionTaxFacts['books'],releasesEntireActivity:result});
 }
 return results;
}
