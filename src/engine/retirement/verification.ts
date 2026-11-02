import type {ForecastCheckpoint,ForecastYearStep,RetirementPosting} from '../forecast/types';
import type {Issue} from '../model/results';
import type {RetirementRecurringCashMonth} from './recurring-cash';
import {Decimal} from '../money';
import {combineAvailableCents,mapAvailableCents} from '../tax/modified-income';
/** Cross-check the posted runtime against independent accepted account/tax and recurring/capital cash dimensions. */
export function verifyRetirementPosting(opening:ForecastCheckpoint,posting:RetirementPosting,recurring:readonly RetirementRecurringCashMonth[],mechanical:ForecastYearStep,actual:ForecastYearStep,replay:ForecastYearStep):readonly Issue[]{
 const fields=new Set<string>(),same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 if(!same(actual.closing,replay.closing))fields.add('replay');
 for(const key of ['propertyExact','existingHomeExact','loanClosing','priorMarketComplete'] as const)if(!same(actual.closing[key],mechanical.closing[key]))fields.add(key);
 if(!same(actual.closing.taxState,posting.household.closingTaxState))fields.add('taxState');
 if(!same(actual.closing.retirementAccountBalances,posting.closingAccounts))fields.add('accountBasis');
 for(const a of posting.closingAccounts){const v=actual.closing.accountExact[a.accountId];if(!v||v.status!=='available'||!new Decimal(v.value).eq(a.balanceExact))fields.add(`accountExact.${a.accountId}`);const basis=actual.closing.brokerageBasis[a.accountId];if(a.type==='taxable-brokerage'&&(!basis||basis.status!=='available'||basis.value!==(a.basis.known?a.basis.value:a.estimatedBasisCents??0)))fields.add(`brokerageBasis.${a.accountId}`);}
 let cash=opening.reserve,earmarked=opening.lastEarmarked;
 for(const [index,row]of actual.projection.months.entries()){
  const flow=recurring[index]!,endEarmark=row.adu?.earmarkedCashCents??{status:'available' as const,value:0},negative=(v:typeof cash)=>mapAvailableCents(v,n=>-n),expected=combineAvailableCents([cash,flow.rentalCashCents,flow.otherCashIncomeCents,negative(flow.personalExpensesCents),negative(flow.personalDebtPaymentsCents),negative(flow.capitalFundingCents),endEarmark,negative(earmarked),posting.cashTransfersByMonth[index]!,negative(row.totalTaxCents)]);
  if(expected.status==='available'&&row.reserveCents.status==='available'&&expected.value!==row.reserveCents.value)fields.add(`cash.${index+1}`);
  cash=row.reserveCents;earmarked=endEarmark;
 }
 return [...fields].map(field=>({code:'retirement-ledger-mismatch',year:opening.year,field,severity:'error',explanation:'The posted retirement cash, asset, debt, basis or tax state did not reconcile with its accepted immutable schedule.',resolution:'Recalculate and inspect the located ledger dimension; this result cannot be published as verified.'}));
}
