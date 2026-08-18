import type { Account, AnnualProjection, Asset, BasisPoints, Cents, Liability, Scenario } from "./types";
import { vestedAssetValue, vestedEquityValue } from "./projection";

export type RetirementTaxClass = "taxable" | "pre-tax" | "roth";
export type RetirementExpenseBucket =
  | { id:string; name:string; mode:"monthly"; monthlyCents:Cents }
  | { id:string; name:string; mode:"annual"; annualCents:Cents }
  | { id:string; name:string; mode:"percent"; percentBps:BasisPoints };
export interface RetirementStockTarget { id:string; kind:"stock"; name:string; targetBalanceCents:Cents; sourceAccountId?:string; taxClass:RetirementTaxClass; annualReturnBps:BasisPoints; costBasisCents?:Cents; residual?:boolean }
export interface RetirementPropertyTarget {
  id:string; kind:"property"; origin:"plan"|"investment"|"manual"; name:string; sourceAssetId?:string; sourceMortgageId?:string;
  valueCents:Cents; monthlyRentCents:Cents; downPaymentBps:BasisPoints; purchaseCostBps:BasisPoints; mortgageRateBps:BasisPoints; mortgageTermYears:number;
  appreciationBps:BasisPoints; propertyTaxBps:BasisPoints; annualInsuranceCents:Cents; monthlyHoaCents:Cents; maintenanceBps:BasisPoints; incomeGrowthBps:BasisPoints;
  homeSquareFeet?:number; aduSquareFeet?:number; aduBuildYear?:number; aduBuildCostCents?:Cents; aduMonthlyRentCents?:Cents;
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

export interface RetirementReadinessYear { year:number; projectedCapitalCents:Cents; requiredFundingCents:Cents; fundingGapCents:Cents; spendableIncomeCents:Cents; plannedSpendingCents:Cents; leftoverCents:Cents; endingBalanceCents:Cents; portfolioFunded:boolean; portfolioPurchased:boolean; runwayPasses:boolean; firstFailureYear?:number }
export interface RetirementResult { years:RetirementReadinessYear[]; selected:RetirementReadinessYear; earliestReadyYear?:number; acquisitionYear?:number; selectedYearAffordable:boolean }
export interface RetirementCalculationInput { plan:RetirementPlanRecord; accounts:readonly Account[]; assets:readonly Asset[]; liabilities:readonly Liability[]; scenario:Scenario; projections:readonly AnnualProjection[]; currentYear:number; asOfDate?:string }

const mortgagePayment=(principal:number,bps:number,years:number)=>{const r=bps/10_000/12,n=years*12;return r?principal*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1):principal/n};
const taxOnWithdrawal=(amount:number,kind:RetirementTaxClass,basisRatio:number)=>kind==="roth"?0:kind==="pre-tax"?amount*.25:amount*(1-basisRatio)*.20;
const inflationAt=(input:RetirementCalculationInput,year:number)=>Math.pow(1+input.scenario.assumptions.inflationBps/10_000,Math.max(0,year-input.currentYear));
const balanceAt=(input:RetirementCalculationInput,year:number,id:string)=>{
  const account=input.accounts.find(a=>a.id===id);if(!account)return 0;
  if(year===input.currentYear)return account.balanceCents;
  return input.projections.find(p=>p.year===year-1)?.months.at(-1)?.balances?.accounts[id]??0;
};
const assetAt=(input:RetirementCalculationInput,year:number,id:string)=>{
  const asset=input.assets.find(a=>a.id===id);if(!asset)return 0;
  if(year===input.currentYear){const date=input.asOfDate??`${year}-12-31`;return asset.equityHolding?vestedEquityValue(asset,date):asset.privateStock?vestedAssetValue(asset,date):asset.valueCents}
  const balances=input.projections.find(p=>p.year===year-1)?.months.at(-1)?.balances;
  return balances?.assets[id]??balances?.privateStock[id]?.vestedCents??0;
};
const liabilityAt=(input:RetirementCalculationInput,year:number,id:string)=>{
  const liability=input.liabilities.find(l=>l.id===id);if(!liability)return 0;
  if(year===input.currentYear)return liability.balanceCents;
  return input.projections.find(p=>p.year===year-1)?.months.at(-1)?.balances?.liabilities[id]??0;
};
const fundingAt=(input:RetirementCalculationInput,year:number)=>
  input.accounts.filter(x=>input.plan.selectedSourceIds.includes(x.id)).reduce((sum,x)=>sum+balanceAt(input,year,x.id),0)+
  input.assets.filter(x=>input.plan.selectedSourceIds.includes(x.id)).reduce((sum,x)=>sum+assetAt(input,year,x.id),0)-
  input.liabilities.filter(x=>input.plan.selectedSourceIds.includes(x.id)).reduce((sum,x)=>sum+liabilityAt(input,year,x.id),0);
const requiredAt=(input:RetirementCalculationInput,year:number)=>input.plan.portfolioItems.reduce((sum,item)=>{
  if(item.kind==="stock")return item.residual?sum:sum+item.targetBalanceCents*inflationAt(input,year);
  if(item.origin==="plan")return sum;
  return sum+item.valueCents*(item.downPaymentBps+item.purchaseCostBps)/10_000+(item.aduBuildCostCents??0);
},0);

type RunningStock=RetirementStockTarget&{balance:number;basis:number};
type RunningProperty=RetirementPropertyTarget&{value:number;taxBasis:number;rent:number;principal:number;payment:number;buildOffset:number;aduBuilt:boolean;retirementPurchase:boolean};
type AnnualRun={year:number;spendable:number;spending:number;left:number;ending:number};

function simulate(input:RetirementCalculationInput,acquisitionYear:number,capital:number,required:number){
  const acquisitionInflation=inflationAt(input,acquisitionYear);
  let stocks:RunningStock[]=input.plan.portfolioItems.filter((x):x is RetirementStockTarget=>x.kind==="stock"&&!x.residual).map(x=>({...x,balance:x.targetBalanceCents*acquisitionInflation,basis:(x.costBasisCents??x.targetBalanceCents)*acquisitionInflation}));
  const residual=input.plan.portfolioItems.find((x):x is RetirementStockTarget=>x.kind==="stock"&&!!x.residual)??{id:"remaining-investment-capital",kind:"stock",residual:true,name:"Remaining investment capital",targetBalanceCents:0,taxClass:"taxable",annualReturnBps:700,costBasisCents:0} as RetirementStockTarget;
  const residualBalance=Math.max(0,capital-required);
  stocks.push({...residual,balance:residualBalance,basis:residualBalance});
  let properties:RunningProperty[]=input.plan.portfolioItems.filter((x):x is RetirementPropertyTarget=>x.kind==="property").map(x=>{
    const retirementPurchase=x.origin!=="plan",value=retirementPurchase?x.valueCents:assetAt(input,acquisitionYear,x.sourceAssetId??"")||x.valueCents*acquisitionInflation;
    const buildOffset=(x.aduBuildYear??Number.POSITIVE_INFINITY)-1,aduBuilt=buildOffset===0;
    const added=aduBuilt&&x.homeSquareFeet?value/x.homeSquareFeet*(x.aduSquareFeet??0):0;
    const principal=retirementPurchase?value*(1-x.downPaymentBps/10_000):liabilityAt(input,acquisitionYear,x.sourceMortgageId??"");
    return {...x,retirementPurchase,value:value+added,taxBasis:value+added,rent:(x.monthlyRentCents+(aduBuilt?(x.aduMonthlyRentCents??0):0))*12,principal,payment:mortgagePayment(principal,x.mortgageRateBps,x.mortgageTermYears),buildOffset,aduBuilt};
  });
  const rows:AnnualRun[]=[];let firstFailure:number|undefined;
  for(let i=0;i<input.plan.runwayYears;i++){
    const year=acquisitionYear+i,inflation=inflationAt(input,year);let rental=0;
    properties=properties.map(p=>{
      const buildsNow=!p.aduBuilt&&i>=p.buildOffset,added=buildsNow&&p.homeSquareFeet?p.value/p.homeSquareFeet*(p.aduSquareFeet??0):0;
      const value=p.value+added,taxBasis=p.taxBasis+added,rent=p.rent+(buildsNow?(p.aduMonthlyRentCents??0)*12:0);
      const interest=p.principal*p.mortgageRateBps/10_000,pay=Math.min(p.principal,Math.max(0,p.payment*12-interest)),mortgage=p.principal>0?p.payment*12:0;
      const costs=taxBasis*p.propertyTaxBps/10_000+value*p.maintenanceBps/10_000+p.annualInsuranceCents*Math.pow(1+input.scenario.assumptions.inflationBps/10_000,i)+p.monthlyHoaCents*12*Math.pow(1+input.scenario.assumptions.inflationBps/10_000,i);
      rental+=rent-mortgage-costs;
      return {...p,aduBuilt:p.aduBuilt||buildsNow,principal:Math.max(0,p.principal-pay),value:value*(1+p.appreciationBps/10_000),taxBasis:taxBasis*1.02,rent:rent*(1+p.incomeGrowthBps/10_000)};
    });
    const gross=stocks.reduce((sum,x)=>sum+x.balance*input.plan.withdrawalRateBps/10_000,0);let taxes=0,remaining=gross;
    for(const kind of input.plan.withdrawalOrder)for(const stock of stocks.filter(x=>x.taxClass===kind)){const take=Math.min(remaining,stock.balance*input.plan.withdrawalRateBps/10_000);taxes+=taxOnWithdrawal(take,kind,stock.balance?Math.min(1,stock.basis/stock.balance):1);remaining-=take}
    const spendable=Math.max(0,rental+gross-taxes),spending=input.plan.expenseBuckets.reduce((sum,b)=>sum+annualBucketAmount(b,spendable/inflation)*inflation,0);let need=Math.max(0,spending-rental);
    for(const kind of input.plan.withdrawalOrder)for(const stock of stocks.filter(x=>x.taxClass===kind)){const take=Math.min(need,stock.balance),ratio=stock.balance?Math.min(1,stock.basis/stock.balance):0;stock.balance-=take;stock.basis-=take*ratio;need-=take}
    stocks=stocks.map(x=>({...x,balance:x.balance*(1+x.annualReturnBps/10_000)}));
    if(need>1&&firstFailure===undefined)firstFailure=year;
    const ending=stocks.reduce((sum,x)=>sum+x.balance,0)+properties.reduce((sum,p)=>sum+p.value-p.principal,0);
    rows.push({year,spendable:spendable/inflation,spending:spending/inflation,left:(spendable-spending)/inflation,ending:ending/inflation});
  }
  return {rows,firstFailure,runwayPasses:firstFailure===undefined};
}

export function calculateRetirement(input:RetirementCalculationInput):RetirementResult {
  const end=input.currentYear+Math.max(0,Math.floor(input.scenario.horizon.months/12));
  const calendarYears=Array.from({length:end-input.currentYear+1},(_,i)=>input.currentYear+i);
  const acquisitionYear=calendarYears.find(year=>year>=input.plan.retirementYear&&fundingAt(input,year)>=requiredAt(input,year));
  const acquisitionCapital=acquisitionYear===undefined?0:fundingAt(input,acquisitionYear),acquisitionRequired=acquisitionYear===undefined?0:requiredAt(input,acquisitionYear);
  const run=acquisitionYear===undefined?undefined:simulate(input,acquisitionYear,acquisitionCapital,acquisitionRequired);
  const years=calendarYears.map(year=>{
    const inflation=inflationAt(input,year),capital=fundingAt(input,year),required=requiredAt(input,year),purchased=acquisitionYear!==undefined&&year>=acquisitionYear,row=run?.rows.find(x=>x.year===year);
    return {year,projectedCapitalCents:Math.round((purchased?(row?.ending??0):capital)/inflation),requiredFundingCents:Math.round(purchased?0:required/inflation),fundingGapCents:Math.round(purchased?0:Math.max(0,required-capital)/inflation),spendableIncomeCents:Math.round(row?.spendable??0),plannedSpendingCents:Math.round(row?.spending??0),leftoverCents:Math.round(row?.left??0),endingBalanceCents:Math.round(row?.ending??capital/inflation),portfolioFunded:purchased||capital>=required,portfolioPurchased:purchased,runwayPasses:purchased&&(run?.runwayPasses??false),firstFailureYear:purchased?run?.firstFailure:undefined};
  });
  const selected=years.find(x=>x.year===input.plan.retirementYear)??years[0],selectedYearAffordable=acquisitionYear===input.plan.retirementYear;
  return {years,selected,acquisitionYear,selectedYearAffordable,earliestReadyYear:run?.runwayPasses?acquisitionYear:undefined};
}
