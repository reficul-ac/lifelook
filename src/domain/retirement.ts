import type { Account, AnnualProjection, Asset, BasisPoints, Cents, Liability, Scenario } from "./types";

export type RetirementTaxClass = "taxable" | "pre-tax" | "roth";
export type RetirementExpenseBucket =
  | { id:string; name:string; mode:"monthly"; monthlyCents:Cents }
  | { id:string; name:string; mode:"annual"; annualCents:Cents }
  | { id:string; name:string; mode:"percent"; percentBps:BasisPoints };
export interface RetirementStockTarget { id:string; kind:"stock"; name:string; targetBalanceCents:Cents; sourceAccountId?:string; taxClass:RetirementTaxClass; annualReturnBps:BasisPoints; costBasisCents?:Cents }
export interface RetirementPropertyTarget {
  id:string; kind:"property"; origin:"plan"|"investment"|"manual"; name:string; sourceAssetId?:string; sourceMortgageId?:string;
  valueCents:Cents; monthlyRentCents:Cents; downPaymentBps:BasisPoints; purchaseCostBps:BasisPoints; mortgageRateBps:BasisPoints; mortgageTermYears:number;
  appreciationBps:BasisPoints; propertyTaxBps:BasisPoints; annualInsuranceCents:Cents; monthlyHoaCents:Cents; maintenanceBps:BasisPoints; incomeGrowthBps:BasisPoints;
}
export type RetirementPortfolioItem = RetirementStockTarget | RetirementPropertyTarget;
export interface RetirementPlanRecord {
  householdId:string; selectedScenarioId:string; retirementYear:number; runwayYears:50; withdrawalRateBps:BasisPoints;
  expenseBuckets:RetirementExpenseBucket[]; selectedSourceIds:string[]; portfolioItems:RetirementPortfolioItem[]; withdrawalOrder:RetirementTaxClass[]; revision:number;
}
export const defaultRetirementPlan = (year=new Date().getFullYear()):Omit<RetirementPlanRecord,"householdId"> => ({
  selectedScenarioId:"", retirementYear:year, runwayYears:50, withdrawalRateBps:300,
  expenseBuckets:[], selectedSourceIds:[], portfolioItems:[], withdrawalOrder:["taxable","pre-tax","roth"], revision:1,
});
export const annualBucketAmount=(bucket:RetirementExpenseBucket,spendableCents:number)=>bucket.mode==="monthly"?bucket.monthlyCents*12:bucket.mode==="annual"?bucket.annualCents:Math.round(spendableCents*bucket.percentBps/10_000);

export interface RetirementReadinessYear { year:number; projectedCapitalCents:Cents; requiredFundingCents:Cents; fundingGapCents:Cents; spendableIncomeCents:Cents; plannedSpendingCents:Cents; leftoverCents:Cents; endingBalanceCents:Cents; portfolioFunded:boolean; runwayPasses:boolean; firstFailureYear?:number }
export interface RetirementResult { years:RetirementReadinessYear[]; selected:RetirementReadinessYear; earliestReadyYear?:number }
export interface RetirementCalculationInput { plan:RetirementPlanRecord; accounts:readonly Account[]; assets:readonly Asset[]; liabilities:readonly Liability[]; scenario:Scenario; projections:readonly AnnualProjection[]; currentYear:number }

const mortgagePayment=(principal:number,bps:number,years:number)=>{const r=bps/10_000/12,n=years*12;return r?principal*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1):principal/n};
const taxOnWithdrawal=(amount:number,kind:RetirementTaxClass,basisRatio:number)=>kind==="roth"?0:kind==="pre-tax"?amount*.25:amount*(1-basisRatio)*.20;
const balanceAt=(input:RetirementCalculationInput,year:number,id:string)=>{
  const account=input.accounts.find(a=>a.id===id); if(!account)return 0;
  if(year===input.currentYear)return account.balanceCents;
  const prior=input.projections.find(p=>p.year===year-1), month=prior?.months.at(-1);
  return month?.balances?.accounts[id]??0;
};
const assetAt=(input:RetirementCalculationInput,year:number,id:string)=>{
  const asset=input.assets.find(a=>a.id===id);if(!asset)return 0;
  if(year===input.currentYear)return asset.valueCents;
  return input.projections.find(p=>p.year===year-1)?.months.at(-1)?.balances?.assets[id]??0;
};
function evaluate(input:RetirementCalculationInput,year:number):RetirementReadinessYear {
  const yearsUntil=Math.max(0,year-input.currentYear), inflation=Math.pow(1+input.scenario.assumptions.inflationBps/10_000,yearsUntil);
  const used=new Set<string>(); let projectedCapital=0,required=0;
  for(const item of input.plan.portfolioItems){
    if(item.kind==="stock"){
      required+=item.targetBalanceCents*inflation;
      if(item.sourceAccountId&&!used.has(item.sourceAccountId)&&input.plan.selectedSourceIds.includes(item.sourceAccountId)){projectedCapital+=balanceAt(input,year,item.sourceAccountId);used.add(item.sourceAccountId)}
    } else if(item.origin==="plan"&&item.sourceAssetId){
      if(!used.has(item.sourceAssetId)&&input.plan.selectedSourceIds.includes(item.sourceAssetId)){projectedCapital+=assetAt(input,year,item.sourceAssetId);used.add(item.sourceAssetId)}
    } else {const value=item.valueCents*Math.pow(1+item.appreciationBps/10_000,yearsUntil);required+=value*(item.downPaymentBps+item.purchaseCostBps)/10_000}
  }
  const unallocated=input.accounts.filter(a=>input.plan.selectedSourceIds.includes(a.id)&&!used.has(a.id));
  projectedCapital+=unallocated.reduce((s,a)=>s+balanceAt(input,year,a.id),0);
  const gap=Math.max(0,required-projectedCapital), funded=gap<1;
  let stocks=input.plan.portfolioItems.filter((x):x is RetirementStockTarget=>x.kind==="stock").map(x=>({...x,balance:x.targetBalanceCents*inflation,basis:(x.costBasisCents??x.targetBalanceCents)*inflation}));
  let properties=input.plan.portfolioItems.filter((x):x is RetirementPropertyTarget=>x.kind==="property").map(x=>{const planned=x.origin!=="plan",value=planned?x.valueCents*Math.pow(1+x.appreciationBps/10_000,yearsUntil):assetAt(input,year,x.sourceAssetId??"")||x.valueCents*inflation;const principal=planned?value*(1-x.downPaymentBps/10_000):input.liabilities.find(l=>l.id===x.sourceMortgageId)?.balanceCents??0;return {...x,value,rent:x.monthlyRentCents*12*Math.pow(1+x.incomeGrowthBps/10_000,yearsUntil),principal,months:x.mortgageTermYears*12,payment:mortgagePayment(principal,x.mortgageRateBps,x.mortgageTermYears)};});
  let firstFailure:number|undefined,firstSpendable=0,firstSpending=0,firstLeft=0;
  for(let i=0;i<input.plan.runwayYears;i++){
    let rental=0;
    properties=properties.map(p=>{const interest=p.principal*p.mortgageRateBps/10_000,pay=Math.min(p.principal,Math.max(0,p.payment*12-interest));const mortgage=p.principal>0?p.payment*12:0;const costs=p.value*(p.propertyTaxBps+p.maintenanceBps)/10_000+p.annualInsuranceCents*Math.pow(1+input.scenario.assumptions.inflationBps/10_000,i)+p.monthlyHoaCents*12*Math.pow(1+input.scenario.assumptions.inflationBps/10_000,i);rental+=p.rent-mortgage-costs;return {...p,principal:Math.max(0,p.principal-pay),value:p.value*(1+p.appreciationBps/10_000),rent:p.rent*(1+p.incomeGrowthBps/10_000)} });
    let capacity=stocks.reduce((s,a)=>s+a.balance*input.plan.withdrawalRateBps/10_000,0), gross=Math.max(0,capacity), taxes=0,remaining=gross;
    for(const kind of input.plan.withdrawalOrder)for(const a of stocks.filter(x=>x.taxClass===kind)){const take=Math.min(remaining,a.balance*input.plan.withdrawalRateBps/10_000);taxes+=taxOnWithdrawal(take,kind,a.balance?Math.min(1,a.basis/a.balance):1);remaining-=take}
    const spendable=Math.max(0,rental+gross-taxes), spending=input.plan.expenseBuckets.reduce((s,b)=>s+annualBucketAmount(b,spendable/inflation)*inflation,0);let need=Math.max(0,spending-rental);
    for(const kind of input.plan.withdrawalOrder)for(const a of stocks.filter(x=>x.taxClass===kind)){const take=Math.min(need,a.balance);const ratio=a.balance?Math.min(1,a.basis/a.balance):0;a.balance-=take;a.basis-=take*ratio;need-=take}
    stocks=stocks.map(a=>({...a,balance:a.balance*(1+a.annualReturnBps/10_000)}));
    if(i===0){firstSpendable=spendable/inflation;firstSpending=spending/inflation;firstLeft=(spendable-spending)/inflation}
    if(need>1&&firstFailure===undefined)firstFailure=year+i;
  }
  const ending=stocks.reduce((s,a)=>s+a.balance,0)+properties.reduce((s,p)=>s+p.value-p.principal,0);
  return {year,projectedCapitalCents:Math.round(projectedCapital/inflation),requiredFundingCents:Math.round(required/inflation),fundingGapCents:Math.round(gap/inflation),spendableIncomeCents:Math.round(firstSpendable),plannedSpendingCents:Math.round(firstSpending),leftoverCents:Math.round(firstLeft),endingBalanceCents:Math.round(ending/Math.pow(1+input.scenario.assumptions.inflationBps/10_000,49)/inflation),portfolioFunded:funded,runwayPasses:firstFailure===undefined,firstFailureYear:firstFailure};
}
export function calculateRetirement(input:RetirementCalculationInput):RetirementResult {const end=input.currentYear+Math.max(0,Math.floor(input.scenario.horizon.months/12));const years=Array.from({length:end-input.currentYear+1},(_,i)=>evaluate(input,input.currentYear+i));return {years,selected:years.find(x=>x.year===input.plan.retirementYear)??years[0],earliestReadyYear:years.find(x=>x.portfolioFunded&&x.runwayPasses)?.year}}
