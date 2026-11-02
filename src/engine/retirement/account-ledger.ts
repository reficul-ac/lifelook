import type {AccountType,Cents,History} from '../model/plan';
import {Decimal,settleCents,assertMonetaryRange} from '../money';
export interface DistributionAccountState {readonly accountId:string;readonly ownerId:string;readonly type:AccountType;readonly balanceExact:string;readonly basis:History<Cents>;readonly estimatedBasisCents?:Cents;readonly californiaBasis?:History<Cents>;readonly estimatedCaliforniaBasisCents?:Cents}
export interface ProposedDistributionLeg {readonly timing?:'dated-monthly';readonly eventId:string;readonly accountId:string;readonly date:string;readonly grossCents:Cents;readonly purpose:'recurring'|'mandatory-excess'|'transition'}
export function depositRetirementAccount(accounts:readonly DistributionAccountState[],accountId:string,amountCents:Cents):readonly DistributionAccountState[]{
 if(!Number.isSafeInteger(amountCents)||amountCents<0)throw new RangeError('A taxable reinvestment requires nonnegative integer cents.');
 const account=accounts.find(a=>a.accountId===accountId);if(!account||account.type!=='taxable-brokerage')throw new RangeError('Retirement reinvestment requires an explicit taxable brokerage destination.');
 assertMonetaryRange(new Decimal(account.balanceExact).plus(amountCents));
 return accounts.map(a=>a.accountId!==accountId?a:{...a,balanceExact:new Decimal(a.balanceExact).plus(amountCents).toString(),basis:a.basis.known?{known:true,value:settleCents(new Decimal(a.basis.value).plus(amountCents))}:{known:false},...(!a.basis.known?{estimatedBasisCents:settleCents(new Decimal(a.estimatedBasisCents??0).plus(amountCents))}:{}),...(a.californiaBasis?{californiaBasis:a.californiaBasis.known?{known:true,value:settleCents(new Decimal(a.californiaBasis.value).plus(amountCents))}:{known:false},...(!a.californiaBasis.known?{estimatedCaliforniaBasisCents:settleCents(new Decimal(a.estimatedCaliforniaBasisCents??a.estimatedBasisCents??0).plus(amountCents))}:{})}:{})});
}
/** Diversification sells held employer shares, leaving other wrappers and holdings intact. */
export function compileRetirementDiversification(accounts:readonly DistributionAccountState[],date:string):readonly ProposedDistributionLeg[]{
 return accounts.filter(a=>a.type==='rsu'&&new Decimal(a.balanceExact).gte(1)).sort((a,b)=>a.accountId.localeCompare(b.accountId)).map(a=>({eventId:`diversify:${date}:${a.accountId}`,accountId:a.accountId,date,grossCents:settleCents(new Decimal(a.balanceExact).floor()),purpose:'transition'}));
}
