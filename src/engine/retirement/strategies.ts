import type {Cents} from '../model/plan';
import type {Available} from '../model/results';
import type {YearRules} from '../rules/types';
export const retirementStrategyIds=['annual-tax-aware','roth-first','taxable-first','traditional-first'] as const;
export const MAX_ANNUAL_MIX_TRIALS=48;
export interface RetirementObjective {readonly strategyId:string;readonly completion:'complete'|'conditional'|'unavailable';readonly totalAfterTaxIncomeCents:Available<Cents>;readonly endingNetWorthCents:Available<Cents>;readonly additionalDistributionTaxCents:Available<Cents>}
/** A fully calculated, funded path outranks an estimate conditional on future funding. */
export function compareRetirementObjectives(a:RetirementObjective,b:RetirementObjective):number {
 const rank={complete:0,conditional:1,unavailable:2},completion=rank[a.completion]-rank[b.completion];if(completion)return completion;
 for(const [field,direction]of [['totalAfterTaxIncomeCents',-1],['endingNetWorthCents',-1],['additionalDistributionTaxCents',1]] as const){const x=a[field],y=b[field];if(x.status!==y.status){if(x.status==='available')return -1;if(y.status==='available')return 1;}if(x.status==='available'&&y.status==='available'&&x.value!==y.value)return direction*(x.value-y.value);}
 return a.strategyId.localeCompare(b.strategyId);
}
/** Finite annual gross traditional preferences; all trials still obey required draws and actual balances. */
export function annualMixCandidates(input:{targetCents:Cents;traditionalCapCents:Cents;baseFederalTaxableCents:Cents;baseCaliforniaTaxableCents:Cents;rules:YearRules}):readonly Cents[]{
 const {rules}=input,cap=Math.max(0,Math.min(input.targetCents,input.traditionalCapCents)),points=new Set([0,cap]);
 const add=(v:number)=>{const n=Math.max(0,Math.min(cap,Math.round(v)));for(const d of [0,-1,1])if(n+d>=0&&n+d<=cap)points.add(n+d);};
 add(rules.federal.standardDeductionCents);add(rules.california.standardDeductionCents);
 for(const b of rules.federal.brackets)if(b.upperCents!==null)add(b.upperCents-input.baseFederalTaxableCents);
 for(const b of rules.california.brackets)if(b.upperCents!==null)add(b.upperCents-input.baseCaliforniaTaxableCents);
 add(rules.federal.capitalGains.zeroRateMaximumCents-input.baseFederalTaxableCents);add(rules.federal.capitalGains.fifteenRateMaximumCents-input.baseFederalTaxableCents);
 const perOrder=MAX_ANNUAL_MIX_TRIALS/2,sorted=[...points].sort((a,b)=>a-b);return sorted.length<=perOrder?sorted:[...sorted.slice(0,perOrder-1),cap];
}
