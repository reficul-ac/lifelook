import type { BasisPoints, Cents } from "./types";

export interface InvestmentAssumptions {
  homePriceCents:Cents; downPaymentBps:BasisPoints; mortgageRateBps:BasisPoints; mortgageTermYears:number;
  monthlyRentCents:Cents; stockReturnBps:BasisPoints; homeAppreciationBps:BasisPoints; horizonYears:number;
  purchaseCostBps:BasisPoints; sellingCostBps:BasisPoints; rentGrowthBps:BasisPoints; propertyTaxBps:BasisPoints;
  annualInsuranceCents:Cents; insuranceGrowthBps:BasisPoints; monthlyHoaCents:Cents; hoaGrowthBps:BasisPoints; maintenanceBps:BasisPoints;
  monthlyRentalIncomeCents:Cents; rentalIncomeGrowthBps:BasisPoints;
}
export interface InvestmentComparisonRecord { householdId:string; assumptions:InvestmentAssumptions; revision:number }
export interface InvestmentValidationError { field:keyof InvestmentAssumptions|"comparison"; message:string; month?:number; year?:number }
export interface InvestmentMonth { month:number; stockValueCents:Cents; homeValueCents:Cents; mortgageBalanceCents:Cents; equityCents:Cents; saleProceedsCents:Cents; rentalPortfolioCents:Cents; buyRetainedTotalCents:Cents; buySaleTotalCents:Cents; rentalIncomeCents:Cents; principalCents:Cents; interestCents:Cents; ownerOutlayCents:Cents; rentCents:Cents; stockContributionCents:Cents }
export interface InvestmentYear extends Omit<InvestmentMonth,"month"|"principalCents"|"interestCents"> { year:number; principalCents:Cents; interestCents:Cents }
export interface InvestmentCrossover { month:number; year:number; leader:"rent-invest"|"buy" }
export interface InvestmentResult { months:InvestmentMonth[]; years:InvestmentYear[]; equityCrossovers:InvestmentCrossover[]; saleCrossovers:InvestmentCrossover[] }
export type InvestmentCalculation={ok:true;result:InvestmentResult}|{ok:false;errors:InvestmentValidationError[]};

export const defaultInvestmentAssumptions:InvestmentAssumptions={
  homePriceCents:50_000_000,downPaymentBps:2000,mortgageRateBps:650,mortgageTermYears:30,monthlyRentCents:250_000,
  stockReturnBps:700,homeAppreciationBps:300,horizonYears:30,purchaseCostBps:300,sellingCostBps:600,rentGrowthBps:300,
  propertyTaxBps:110,annualInsuranceCents:200_000,insuranceGrowthBps:300,monthlyHoaCents:0,hoaGrowthBps:300,maintenanceBps:100,
  monthlyRentalIncomeCents:0,rentalIncomeGrowthBps:300,
};

const finite=(n:number)=>Number.isFinite(n);
export function validateInvestmentAssumptions(a:InvestmentAssumptions):InvestmentValidationError[]{
  const errors:InvestmentValidationError[]=[];
  const moneyFields:(keyof InvestmentAssumptions)[]=["homePriceCents","monthlyRentCents","annualInsuranceCents","monthlyHoaCents","monthlyRentalIncomeCents"];
  moneyFields.forEach(field=>{if(!finite(a[field])||a[field]<0||a[field]>99_999_999_999_999)errors.push({field,message:"Enter a valid non-negative amount."})});
  if(a.homePriceCents<=0)errors.push({field:"homePriceCents",message:"Home price must be greater than zero."});
  const rates:(keyof InvestmentAssumptions)[]=["mortgageRateBps","stockReturnBps","homeAppreciationBps","purchaseCostBps","sellingCostBps","rentGrowthBps","propertyTaxBps","insuranceGrowthBps","hoaGrowthBps","maintenanceBps","rentalIncomeGrowthBps"];
  rates.forEach(field=>{if(!finite(a[field])||a[field]<0||a[field]>10_000)errors.push({field,message:"Enter a percentage from 0% to 100%."})});
  if(!finite(a.downPaymentBps)||a.downPaymentBps<0||a.downPaymentBps>=10_000)errors.push({field:"downPaymentBps",message:"Down payment must be from 0% to less than 100%."});
  if(!Number.isInteger(a.mortgageTermYears)||a.mortgageTermYears<1||a.mortgageTermYears>50)errors.push({field:"mortgageTermYears",message:"Mortgage term must be 1 to 50 years."});
  if(!Number.isInteger(a.horizonYears)||a.horizonYears<1||a.horizonYears>50)errors.push({field:"horizonYears",message:"Projection horizon must be 1 to 50 years."});
  return errors;
}

export function mortgagePayment(principal:number,annualRateBps:number,months:number){
  if(principal<=0)return 0; const rate=annualRateBps/10_000/12;
  return rate===0?principal/months:principal*rate/(1-Math.pow(1+rate,-months));
}
const rounded=(n:number)=>Math.round(n);
function crossovers(months:InvestmentMonth[],buy:(m:InvestmentMonth)=>number):InvestmentCrossover[]{
  const found:InvestmentCrossover[]=[]; let previous=Math.sign(months[0].stockValueCents-buy(months[0]));
  for(const point of months.slice(1)){const sign=Math.sign(point.stockValueCents-buy(point));if(sign!==0&&previous!==0&&sign!==previous)found.push({month:point.month,year:Math.ceil(point.month/12),leader:sign>0?"rent-invest":"buy"});if(sign!==0)previous=sign} return found;
}
export function calculateInvestmentComparison(a:InvestmentAssumptions):InvestmentCalculation{
  const errors=validateInvestmentAssumptions(a); if(errors.length)return {ok:false,errors};
  const loan=a.homePriceCents*(1-a.downPaymentBps/10_000),term=a.mortgageTermYears*12,payment=mortgagePayment(loan,a.mortgageRateBps,term);
  const stockMonthly=a.stockReturnBps/120_000,homeMonthly=a.homeAppreciationBps/120_000;
  let stock=a.homePriceCents*(a.downPaymentBps+a.purchaseCostBps)/10_000,home=a.homePriceCents,balance=loan,rentalPortfolio=0;
  const initialEquity=home-balance,initialSale=home*(1-a.sellingCostBps/10_000)-balance;
  const months:InvestmentMonth[]=[{month:0,stockValueCents:rounded(stock),homeValueCents:rounded(home),mortgageBalanceCents:rounded(balance),equityCents:rounded(initialEquity),saleProceedsCents:rounded(initialSale),rentalPortfolioCents:0,buyRetainedTotalCents:rounded(initialEquity),buySaleTotalCents:rounded(initialSale),rentalIncomeCents:0,principalCents:0,interestCents:0,ownerOutlayCents:0,rentCents:0,stockContributionCents:0}];
  for(let month=1;month<=a.horizonYears*12;month++){
    stock*=1+stockMonthly; rentalPortfolio*=1+stockMonthly; home*=1+homeMonthly;
    const interest=month<=term?balance*a.mortgageRateBps/10_000/12:0,principal=month<=term?Math.min(balance,payment-interest):0; balance=Math.max(0,balance-principal);
    const elapsed=month-1,rent=a.monthlyRentCents*Math.pow(1+a.rentGrowthBps/120_000,elapsed);
    const tax=home*a.propertyTaxBps/10_000/12,maintenance=home*a.maintenanceBps/10_000/12;
    const insurance=a.annualInsuranceCents*Math.pow(1+a.insuranceGrowthBps/120_000,elapsed)/12;
    const hoa=a.monthlyHoaCents*Math.pow(1+a.hoaGrowthBps/120_000,elapsed);
    const rentalIncome=a.monthlyRentalIncomeCents*Math.pow(1+a.rentalIncomeGrowthBps/120_000,elapsed);
    const owner=(month<=term?principal+interest:0)+tax+maintenance+insurance+hoa;
    if(rent>owner+0.005)return {ok:false,errors:[{field:"comparison",message:`Rent exceeds the homeowner outlay in month ${month} (year ${Math.ceil(month/12)}).`,month,year:Math.ceil(month/12)}]};
    const contribution=owner-rent; stock+=contribution; rentalPortfolio+=rentalIncome;
    const equity=home-balance,sale=home*(1-a.sellingCostBps/10_000)-balance;
    months.push({month,stockValueCents:rounded(stock),homeValueCents:rounded(home),mortgageBalanceCents:rounded(balance),equityCents:rounded(equity),saleProceedsCents:rounded(sale),rentalPortfolioCents:rounded(rentalPortfolio),buyRetainedTotalCents:rounded(equity+rentalPortfolio),buySaleTotalCents:rounded(sale+rentalPortfolio),rentalIncomeCents:rounded(rentalIncome),principalCents:rounded(principal),interestCents:rounded(interest),ownerOutlayCents:rounded(owner),rentCents:rounded(rent),stockContributionCents:rounded(contribution)});
  }
  const years:InvestmentYear[]=[];
  for(let year=1;year<=a.horizonYears;year++){const slice=months.slice((year-1)*12+1,year*12+1),end=slice.at(-1)!;years.push({year,stockValueCents:end.stockValueCents,homeValueCents:end.homeValueCents,mortgageBalanceCents:end.mortgageBalanceCents,equityCents:end.equityCents,saleProceedsCents:end.saleProceedsCents,rentalPortfolioCents:end.rentalPortfolioCents,buyRetainedTotalCents:end.buyRetainedTotalCents,buySaleTotalCents:end.buySaleTotalCents,rentalIncomeCents:slice.reduce((s,m)=>s+m.rentalIncomeCents,0),principalCents:slice.reduce((s,m)=>s+m.principalCents,0),interestCents:slice.reduce((s,m)=>s+m.interestCents,0),ownerOutlayCents:slice.reduce((s,m)=>s+m.ownerOutlayCents,0),rentCents:slice.reduce((s,m)=>s+m.rentCents,0),stockContributionCents:slice.reduce((s,m)=>s+m.stockContributionCents,0)})}
  return {ok:true,result:{months,years,equityCrossovers:crossovers(months,m=>m.buyRetainedTotalCents),saleCrossovers:crossovers(months,m=>m.buySaleTotalCents)}};
}
