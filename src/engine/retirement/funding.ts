import type {Cents} from '../model/plan';
import type {Available,Issue} from '../model/results';
import {MAX_CENTS} from '../money';
export const MAX_RETIREMENT_FUNDING_EVALUATIONS=96;
export interface RetirementFundingEvaluation<T> {readonly netFundingCents:Available<Cents>;readonly verification:string;readonly payload:T}
export interface RetirementFundingInput<T> {readonly openingAssets:unknown;readonly events:readonly unknown[];readonly maximumGrossCents:Cents;readonly evaluate:(grossCents:Cents)=>RetirementFundingEvaluation<T>}
export interface RetirementFundingResult<T=unknown> {readonly status:'verified'|'shortfall'|'nonconvergent'|'unavailable';readonly grossCents:Available<Cents>;readonly shortfallCents:Available<Cents>;readonly evaluations:number;readonly evaluation?:RetirementFundingEvaluation<T>;readonly oneCentLowerVerified:boolean;readonly issues:readonly Issue[]}
const av=<T>(value:T):Available<T>=>({status:'available',value});
/** Signed fixed-point proposals plus local cent-boundary and fresh financial-ledger replay checks. */
export function solveRetirementFunding<T>(input:RetirementFundingInput<T>):RetirementFundingResult<T> {
 if(!Number.isSafeInteger(input.maximumGrossCents)||input.maximumGrossCents<0||input.maximumGrossCents>MAX_CENTS)throw new RangeError('Invalid retirement funding capacity.');
 const original=JSON.stringify([input.openingAssets,input.events]),visited=new Set<number>();let evaluations=0,gross=0,last:RetirementFundingEvaluation<T>|undefined,lastAdequate:number|undefined;
 const problem=(code:string,message:string):Issue=>({code,field:'retirementFunding',severity:'warning',explanation:message,resolution:'Review the opening assets, transition events and annual tax evaluation; no unverified funding amount is published.'});
 const result=(status:RetirementFundingResult<T>['status'],issues:readonly Issue[]=[],boundary=false):RetirementFundingResult<T>=>({status,grossCents:av(gross),shortfallCents:status==='verified'?av(0):status==='shortfall'&&last?.netFundingCents.status==='available'?av(Math.max(0,-last.netFundingCents.value)):last?.netFundingCents.status!=='available'&&last?last.netFundingCents:{status:'needs-data',issues},evaluations,...(last?{evaluation:last}:{}),oneCentLowerVerified:boundary,issues});
 const evaluate=(g:number):RetirementFundingEvaluation<T>|undefined=>{
  if(evaluations>=MAX_RETIREMENT_FUNDING_EVALUATIONS)return undefined;evaluations++;
  const value=input.evaluate(g);if(JSON.stringify([input.openingAssets,input.events])!==original)return undefined;
  if(value.netFundingCents.status==='available'&&(!Number.isSafeInteger(value.netFundingCents.value)||Math.abs(value.netFundingCents.value)>MAX_CENTS))throw new RangeError('Invalid funding evaluation.');
  return value;
 };
 const equal=(a:RetirementFundingEvaluation<T>,b:RetirementFundingEvaluation<T>)=>a.verification===b.verification&&JSON.stringify(a.netFundingCents)===JSON.stringify(b.netFundingCents);
 while(evaluations<MAX_RETIREMENT_FUNDING_EVALUATIONS){
  const current=evaluate(gross);if(!current)break;last=current;
  if(current.netFundingCents.status!=='available')return result('unavailable',current.netFundingCents.issues);
  const net=current.netFundingCents.value;
  if(net>=0){
   lastAdequate=gross;let boundary=gross===0;
   if(gross>0){const lower=evaluate(gross-1);if(!lower)break;if(lower.netFundingCents.status!=='available'){last=lower;return result('unavailable',lower.netFundingCents.issues);}boundary=lower.netFundingCents.value<0;}
   if(boundary){const replay=evaluate(gross);if(!replay||!equal(current,replay))break;last=replay;return result('verified',[],true);}
   let next=Math.max(0,gross-Math.max(1,net));if(visited.has(next))next=gross-1;visited.add(gross);gross=next;
  }else {
   if(gross===input.maximumGrossCents){const replay=evaluate(gross);if(!replay||!equal(current,replay))break;last=replay;return result('shortfall',[problem('retirement-funding-shortfall','The available opening investments cannot fund the January transition and its incremental tax.')]);}
   let next=Math.min(input.maximumGrossCents,gross-net);if(visited.has(next)&&lastAdequate!==undefined)next=lastAdequate-1;
   visited.add(gross);gross=next;
  }
 }
 return result('nonconvergent',[problem('retirement-funding-nonconvergence',`The funding schedule did not pass immutable replay and cent-boundary verification within ${MAX_RETIREMENT_FUNDING_EVALUATIONS} evaluations.`)]);
}
