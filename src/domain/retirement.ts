import type { Account, AnnualProjection, Asset, BasisPoints, Cents, FilingStatus, Liability, Scenario } from "./types";
import type { RetirementTaxResult } from "./retirementTax";
import { occurrences, recurringAmount, vestedAssetValue, vestedEquityValue } from "./projection";

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
  retirementYears?:Record<string,number>; scheduledIncome?:RetirementIncome[]; withdrawalAccountOrder?:string[]; legacyReviewDismissed?:boolean;
  spendingMode?:"manual"|"plan"; liquidatableAssetIds?:string[]; earlyRothAccountIds?:string[]; migrationReview?:string[];
  taxAssumptions?:RetirementTaxAssumptions;
}
export interface RetirementTaxAssumptions { annualQcdCents:Cents; charitableCents:Cents; medicalCents:Cents; federalShortLossCents:Cents; federalLongLossCents:Cents; californiaShortLossCents:Cents; californiaLongLossCents:Cents; mfsLivedApartAllYear:boolean }
export const defaultRetirementTaxAssumptions=():RetirementTaxAssumptions=>({annualQcdCents:0,charitableCents:0,medicalCents:0,federalShortLossCents:0,federalLongLossCents:0,californiaShortLossCents:0,californiaLongLossCents:0,mfsLivedApartAllYear:false});
export type RetirementIncomeClassification="social-security"|"ordinary"|"interest"|"qualified-dividend"|"nonqualified-dividend"|"tax-exempt-interest"|"nontaxable"|"unclassified";
export interface RetirementIncome { id:string; name:string; ownerPersonId:string; startYear:number; annualAmountCents:Cents; annualGrowthBps:BasisPoints; taxableBps?:BasisPoints; classification?:RetirementIncomeClassification }
export type RetirementStressPreset="baseline"|"lower-returns"|"higher-inflation"|"higher-spending"|"longevity"|"combined";
export type RetirementIncomeSourceKind="employment"|"rental"|"scheduled"|"other"|"rmd"|"withdrawal";
export interface RetirementIncomeSource { id:string; name:string; kind:RetirementIncomeSourceKind; amountCents:Cents }
export interface RetirementAccountYear { id:string; name:string; beginningCents:Cents; returnsCents:Cents; withdrawalsCents:Cents; realizedGainsCents:Cents; rmdCents:Cents; endingCents:Cents }
export interface RetirementPropertyYear { id:string; name:string; grossRentCents:Cents; operatingExpenseCents:Cents; debtServiceCents:Cents; netCashFlowCents:Cents; endingValueCents:Cents; endingMortgageCents:Cents; endingEquityCents:Cents }
export interface RetirementOutlookYear { year:number; beginningSpendableCents:Cents; endingSpendableCents:Cents; grossIncomeCents:Cents; employmentIncomeCents:Cents; rentalIncomeCents:Cents; scheduledIncomeCents:Cents; otherIncomeCents:Cents; taxAndPenaltyCents:Cents; afterTaxIncomeCents:Cents; spendingCents:Cents; excessCents:Cents; withdrawalsCents:Cents; endingBalanceCents:Cents; totalAssetsCents:Cents; totalDebtCents:Cents; netWorthCents:Cents; rmdCents:Cents; incomeSources:RetirementIncomeSource[]; accounts:RetirementAccountYear[]; properties:RetirementPropertyYear[]; reconciliationDifferenceCents:Cents; taxStatement?:RetirementTaxResult }
export interface RetirementPortfolioPart { id:string; name:string; kind:"account"|"property"|"asset"|"liability"; valueCents:Cents }
export interface RetirementOutlook { years:RetirementOutlookYear[]; cutoffYear:number; firstRetirementYear:number; cutoffBalanceCents:Cents; cutoffAccountBalanceCents:Cents; cutoffAssetValueCents:Cents; cutoffLiabilityBalanceCents:Cents; portfolioParts:RetirementPortfolioPart[]; firstDepletionYear?:number; endingBalanceCents:Cents; ready:boolean|null; complete:boolean; missingData:string[]; warnings:string[]; preset:"baseline" }
export const defaultRetirementPlan = (year=new Date().getFullYear()):Omit<RetirementPlanRecord,"householdId"> => ({
  selectedScenarioId:"", retirementYear:year, runwayYears:50, withdrawalRateBps:300,
  expenseBuckets:[], selectedSourceIds:[], portfolioItems:[], withdrawalOrder:["taxable","pre-tax","roth"], spendingMode:"manual", liquidatableAssetIds:[], earlyRothAccountIds:[], taxAssumptions:defaultRetirementTaxAssumptions(), revision:1,
});
export const annualBucketAmount=(bucket:RetirementExpenseBucket,spendableCents:number)=>bucket.mode==="monthly"?bucket.monthlyCents*12:bucket.mode==="annual"?bucket.annualCents:Math.round(spendableCents*bucket.percentBps/10_000);

export interface RetirementReadinessYear { year:number; projectedCapitalCents:Cents; requiredFundingCents:Cents; fundingGapCents:Cents; spendableIncomeCents:Cents; plannedSpendingCents:Cents; leftoverCents:Cents; endingBalanceCents:Cents; portfolioFunded:boolean; portfolioPurchased:boolean; runwayPasses:boolean; firstFailureYear?:number }
export interface RetirementResult { years:RetirementReadinessYear[]; selected:RetirementReadinessYear; earliestReadyYear?:number; acquisitionYear?:number; selectedYearAffordable:boolean }
export interface RetirementCalculationInput { plan:RetirementPlanRecord; accounts:readonly Account[]; assets:readonly Asset[]; liabilities:readonly Liability[]; scenario:Scenario; projections:readonly AnnualProjection[]; currentYear:number; asOfDate?:string; filingStatus?:FilingStatus }

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

const accountTaxClass=(account:Account):RetirementTaxClass=>account.subtype==="traditional-ira"||account.subtype==="employer-pre-tax"?"pre-tax":account.subtype==="roth-ira"||account.subtype==="employer-roth"?"roth":"taxable";
const ageAtEnd=(birthDate:string|null|undefined,year:number)=>birthDate?year-Number(birthDate.slice(0,4)):100;
/** Versioned, deterministic retirement rules. 2026 pack; special-case exceptions are intentionally not inferred. */
export const RETIREMENT_RULE_PACK={version:"2026.1",rmdStartAge:73,earlyWithdrawalAge:59.5,earlyPenaltyBps:1000,employerSeparationAge:55,rothFiveYearRule:5} as const;
function calculateLegacyRetirementOutlook(input:RetirementCalculationInput&{people?:readonly {id:string;birthDate?:string|null}[];recurring?:readonly import("./types").RecurringEntry[];preset?:RetirementStressPreset}):RetirementOutlook{
  const personRetirementYears=Object.values(input.plan.retirementYears??{}),cutoffYear=personRetirementYears.length?Math.min(...personRetirementYears):input.plan.retirementYear;
  const preset=input.preset??"baseline",firstRetirement=cutoffYear+1,years=preset==="longevity"||preset==="combined"?60:50;
  const inflationBps=input.scenario.assumptions.inflationBps+(preset==="higher-inflation"||preset==="combined"?100:0),spendFactor=preset==="higher-spending"||preset==="combined"?1.1:1,returnDelta=preset==="lower-returns"||preset==="combined"?-200:0;
  const cutoffMonth=input.projections.find(x=>x.year===cutoffYear)?.months.at(-1),cutoff=cutoffMonth?.balances;
  const balances=new Map(input.accounts.map(a=>[a.id,Math.max(0,cutoff?.accounts[a.id]??a.balanceCents)])),basis=new Map(input.accounts.map(a=>[a.id,a.taxableCostBasisCents??a.rothContributionBasisCents??0]));
  const ordered=[...(input.plan.withdrawalAccountOrder??[]),...input.accounts.map(a=>a.id)].filter((x,i,a)=>a.indexOf(x)===i&&balances.has(x));
  const warnings:string[]=[];if(!cutoff)warnings.push(`The active Plan does not project through ${cutoffYear}; current balance-sheet values are used. Extend the Plan horizon for an accurate retirement cutoff.`);for(const a of input.accounts)if(!a.ownerPersonId||!a.subtype)warnings.push(`${a.name}: owner or tax metadata is missing; conservative withdrawal taxes apply.`);
  if(input.plan.portfolioItems.length&&!input.plan.legacyReviewDismissed)warnings.push("Legacy retirement-only portfolio items need review; they are excluded until added to Plan or dismissed.");
  const propertyRows=cutoffMonth?.properties?.filter(x=>x.status==="active"||x.status==="owner-occupied")??[],propertyIds=new Set(propertyRows.map(x=>x.assetId)),propertyLiabilityIds=new Set(propertyRows.flatMap(x=>x.liabilityId?[x.liabilityId]:[]));
  const eventFor=(assetId:string)=>input.scenario.events.find((x):x is Extract<Scenario["events"][number],{type:"asset-purchase"}>=>x.type==="asset-purchase"&&x.assetId===assetId);
  const properties=propertyRows.map(row=>{const asset=input.assets.find(x=>x.id===row.assetId),event=eventFor(row.assetId),liability=input.liabilities.find(x=>x.id===row.liabilityId);return {id:row.assetId,name:row.name,value:row.assetValueCents??0,mortgage:row.mortgageBalanceCents??0,annualGrowthBps:asset?.annualGrowthBps??event?.annualGrowthBps??0,mortgageRateBps:liability?.annualRateBps??event?.financing?.annualRateBps??0,monthlyPayment:row.principalCents+row.interestCents,monthlyRent:row.rentCents+row.aduIncomeCents,monthlyOperating:row.propertyTaxCents+row.insuranceCents+row.hoaCents+row.maintenanceCents,rentalGrowthBps:event?.propertyDetails?.rentalIncomeGrowthBps??event?.rentalIncomeGrowthBps??0,taxableRental:row.taxableRentalCents};});
  const otherAssets=input.assets.filter(x=>!propertyIds.has(x.id)).map(x=>({id:x.id,name:x.name,value:Math.max(0,cutoff?.assets?.[x.id]??assetAt(input,cutoffYear,x.id)),annualGrowthBps:x.annualGrowthBps}));
  const otherLiabilities=input.liabilities.filter(x=>!propertyLiabilityIds.has(x.id)).map(x=>({id:x.id,name:x.name,balance:Math.max(0,cutoff?.liabilities?.[x.id]??liabilityAt(input,cutoffYear,x.id)),annualRateBps:x.annualRateBps,monthlyPayment:x.minimumPaymentCents}));
  const portfolioParts:RetirementPortfolioPart[]=[...input.accounts.map(a=>({id:a.id,name:a.name,kind:"account" as const,valueCents:balances.get(a.id)??0})),...properties.map(x=>({id:x.id,name:x.name,kind:"property" as const,valueCents:x.value-x.mortgage})),...otherAssets.map(x=>({id:x.id,name:x.name,kind:"asset" as const,valueCents:x.value})),...otherLiabilities.map(x=>({id:x.id,name:x.name,kind:"liability" as const,valueCents:-x.balance}))];
  const cutoffAccountBalanceCents=[...balances.values()].reduce((s,x)=>s+x,0),cutoffAssetValueCents=properties.reduce((s,x)=>s+x.value,0)+otherAssets.reduce((s,x)=>s+x.value,0),cutoffLiabilityBalanceCents=properties.reduce((s,x)=>s+x.mortgage,0)+otherLiabilities.reduce((s,x)=>s+x.balance,0),cutoffBalanceCents=cutoffAccountBalanceCents+cutoffAssetValueCents-cutoffLiabilityBalanceCents;
  const rows:any[]=[];let firstDepletionYear:number|undefined;
  for(let offset=0;offset<years;offset++){
    const year=firstRetirement+offset,inflation=Math.pow(1+inflationBps/10000,offset);
    const incomeSources:RetirementIncomeSource[]=properties.filter(x=>x.monthlyRent>0).map(x=>({id:x.id,name:x.name,kind:"rental",amountCents:x.monthlyRent*12}));
    let rentalIncomeCents=incomeSources.reduce((s,x)=>s+x.amountCents,0),employmentIncomeCents=0,scheduledIncomeCents=0,otherIncomeCents=0,gross=rentalIncomeCents,tax=properties.reduce((s,x)=>s+Math.max(0,Math.round(x.taxableRental*12*.25)),0),rmd=0;
    for(const entry of input.recurring??[]){
      if(entry.kind!=="income")continue;
      const employment=entry.incomeType==="salary"||entry.incomeTaxCategory==="wages";
      if(employment&&(!entry.ownerPersonId||year>(input.plan.retirementYears?.[entry.ownerPersonId]??cutoffYear)))continue;
      let amount=0;
      for(let calendarMonth=1;calendarMonth<=12;calendarMonth++){
        const key=`${year}-${String(calendarMonth).padStart(2,"0")}`,count=occurrences(entry,key);if(!count)continue;
        const changes=input.scenario.events.filter(e=>(e.type==="recurring-change"||e.type==="income-change")&&e.entryId===entry.id&&e.date.slice(0,7)<=key).sort((a,b)=>a.date.localeCompare(b.date)),base=changes.length?(changes.at(-1)! as {amountCents:number}).amountCents:entry.amountCents,growthMonths=Math.max(0,(year-input.currentYear)*12+calendarMonth-1);
        amount+=recurringAmount(entry,base,key,entry.annualGrowthBps??0,growthMonths,count);
      }
      if(!amount)continue;
      const kind=employment?"employment":"other";incomeSources.push({id:entry.id,name:entry.name,kind,amountCents:amount});gross+=amount;tax+=Math.round(amount*.25);if(employment)employmentIncomeCents+=amount;else otherIncomeCents+=amount;
    }
    for(const event of input.scenario.events)if(event.type==="one-time-income"&&Number(event.date.slice(0,4))===year){const employment=event.incomeTaxCategory==="wages";if(employment&&(!event.ownerPersonId||year>(input.plan.retirementYears?.[event.ownerPersonId]??cutoffYear)))continue;const kind=employment?"employment":"other";incomeSources.push({id:event.id,name:"Plan one-time income",kind,amountCents:event.amountCents});gross+=event.amountCents;if(event.incomeTaxCategory!=="nontaxable")tax+=Math.round(event.amountCents*.25);if(employment)employmentIncomeCents+=event.amountCents;else otherIncomeCents+=event.amountCents}
    for(const income of input.plan.scheduledIncome??[])if(year>=income.startYear){const amount=Math.round(income.annualAmountCents*Math.pow(1+income.annualGrowthBps/10000,year-income.startYear));gross+=amount;scheduledIncomeCents+=amount;incomeSources.push({id:income.id,name:income.name,kind:"scheduled",amountCents:amount});tax+=Math.round(amount*(income.taxableBps??0)/10000*.25)}
    // RMDs are retained as cash when they exceed spending needs.
    for(const account of input.accounts.filter(a=>accountTaxClass(a)==="pre-tax"))if(ageAtEnd(input.people?.find(p=>p.id===account.ownerPersonId)?.birthDate,year)>=RETIREMENT_RULE_PACK.rmdStartAge){const amount=Math.min(balances.get(account.id)??0,Math.round((balances.get(account.id)??0)/Math.max(2,27.4-offset)));balances.set(account.id,(balances.get(account.id)??0)-amount);gross+=amount;rmd+=amount;incomeSources.push({id:account.id,name:`${account.name} RMD`,kind:"rmd",amountCents:amount});tax+=Math.round(amount*.25)}
    let afterTax=gross-tax;
    const propertySpending=properties.reduce((s,x)=>s+(x.monthlyOperating+(x.mortgage>0?x.monthlyPayment:0))*12,0),debtSpending=otherLiabilities.reduce((s,x)=>s+(x.balance>0?x.monthlyPayment:0)*12,0);
    const spending=Math.round(input.plan.expenseBuckets.reduce((s,b)=>s+annualBucketAmount(b,afterTax/inflation),0)*inflation*spendFactor)+propertySpending+debtSpending;
    let need=Math.max(0,spending-afterTax),withdrawals=0;
    for(const id of ordered){if(need<=0)break;const account=input.accounts.find(a=>a.id===id)!;let available=balances.get(id)??0;if(!available)continue;const kind=accountTaxClass(account),ownerAge=ageAtEnd(input.people?.find(p=>p.id===account.ownerPersonId)?.birthDate,year),basisAvailable=basis.get(id)??0;let rate=kind==="pre-tax"?2500:kind==="taxable"?Math.round(2000*Math.max(0,1-basisAvailable/Math.max(1,available))):0;if(ownerAge<RETIREMENT_RULE_PACK.earlyWithdrawalAge&&kind==="pre-tax"&&!(account.subtype==="employer-pre-tax"&&ownerAge>=55))rate+=RETIREMENT_RULE_PACK.earlyPenaltyBps;if(kind==="roth"&&ownerAge<59.5&&year-(account.rothOpeningYear??year)<5)rate=1000;const take=Math.min(available,Math.ceil(need/(1-rate/10000)));balances.set(id,available-take);const accountTax=Math.round(take*rate/10000);tax+=accountTax;withdrawals+=take;incomeSources.push({id:account.id,name:account.name,kind:"withdrawal",amountCents:take});afterTax+=take-accountTax;need=Math.max(0,spending-afterTax);if(basisAvailable)basis.set(id,Math.max(0,basisAvailable-take));}
    for(const asset of otherAssets.filter(x=>input.plan.selectedSourceIds.includes(x.id))){if(need<=0)break;const take=Math.min(asset.value,Math.ceil(need/.8)),assetTax=Math.round(take*.2);asset.value-=take;tax+=assetTax;withdrawals+=take;incomeSources.push({id:asset.id,name:asset.name,kind:"withdrawal",amountCents:take});afterTax+=take-assetTax;need=Math.max(0,spending-afterTax)}
    const surplus=Math.max(0,afterTax-spending);if(surplus){const cash=input.accounts.find(a=>a.subtype==="cash"||a.kind==="checking"||a.kind==="savings");if(cash)balances.set(cash.id,(balances.get(cash.id)??0)+surplus)}
    for(const account of input.accounts)balances.set(account.id,Math.round((balances.get(account.id)??0)*(1+Math.max(-10000,account.annualReturnBps+returnDelta)/10000)));
    for(const property of properties){for(let month=0;month<12&&property.mortgage>0;month++){const interest=Math.round(property.mortgage*property.mortgageRateBps/120_000),paid=Math.min(property.mortgage+interest,property.monthlyPayment),principal=Math.max(0,paid-interest);property.mortgage=Math.max(0,property.mortgage-principal)}property.value=Math.round(property.value*(1+(property.annualGrowthBps+returnDelta)/10_000));property.monthlyRent=Math.round(property.monthlyRent*(1+property.rentalGrowthBps/10_000));property.monthlyOperating=Math.round(property.monthlyOperating*(1+inflationBps/10_000));property.taxableRental=Math.round(property.taxableRental*(1+property.rentalGrowthBps/10_000))}
    for(const asset of otherAssets)asset.value=Math.round(asset.value*(1+(asset.annualGrowthBps+returnDelta)/10_000));
    for(const liability of otherLiabilities)for(let month=0;month<12&&liability.balance>0;month++){const interest=Math.round(liability.balance*liability.annualRateBps/120_000),paid=Math.min(liability.balance+interest,liability.monthlyPayment),principal=Math.max(0,paid-interest);liability.balance=Math.max(0,liability.balance-principal)}
    const ending=[...balances.values()].reduce((s,x)=>s+x,0)+properties.reduce((s,x)=>s+x.value-x.mortgage,0)+otherAssets.reduce((s,x)=>s+x.value,0)-otherLiabilities.reduce((s,x)=>s+x.balance,0);if(need>0&&firstDepletionYear===undefined)firstDepletionYear=year;rows.push({year,grossIncomeCents:gross+withdrawals,employmentIncomeCents,rentalIncomeCents,scheduledIncomeCents,otherIncomeCents,taxAndPenaltyCents:tax,afterTaxIncomeCents:afterTax,spendingCents:spending,excessCents:afterTax-spending,withdrawalsCents:withdrawals,endingBalanceCents:ending,rmdCents:rmd,incomeSources});
  }
  return {years:rows as RetirementOutlookYear[],cutoffYear,firstRetirementYear:firstRetirement,cutoffBalanceCents,cutoffAccountBalanceCents,cutoffAssetValueCents,cutoffLiabilityBalanceCents,portfolioParts,firstDepletionYear,endingBalanceCents:rows.at(-1)?.endingBalanceCents??0,ready:firstDepletionYear===undefined,complete:true,missingData:[],warnings,preset:"baseline"};
}
void calculateLegacyRetirementOutlook;
export { calculateRetirementOutlook, ageOnDate, rmdStartAge, uniformLifetimeFactor } from "./retirementOutlook";
