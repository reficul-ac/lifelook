import type { Cents, EmployeeWages, FilingStatus, HouseholdDeductions, TaxabilityBreakdown, TaxBracket, TaxEstimate, TaxLedger, TaxRulePack, TaxSource } from "./types";

const IRS_URL="https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill";
const FTB_URL="https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf";
const SSA_URL="https://www.ssa.gov/oact/cola/cbb.html";
const EDD_URL="https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/";
const IRS_PAYROLL_URL="https://www.irs.gov/publications/p15";
const brackets=(values:[number|null,number][]):TaxBracket[]=>values.map(([value,rateBps])=>({upToCents:value===null?null:value*100,rateBps}));
const sources=(year:2025|2026):TaxSource[]=>[
  {jurisdiction:"federal",sourceYear:year,status:"official",url:IRS_URL},
  {jurisdiction:"california",sourceYear:2025,status:year===2025?"official":"projected",url:FTB_URL},
  {jurisdiction:"payroll",sourceYear:year,status:"official",url:SSA_URL},
  {jurisdiction:"payroll",sourceYear:year,status:"official",url:EDD_URL},
  {jurisdiction:"payroll",sourceYear:year,status:"official",url:IRS_PAYROLL_URL},
];

const ca2025={
  single:brackets([[11079,100],[26264,200],[41452,400],[57542,600],[72724,800],[371479,930],[445771,1030],[742953,1130],[null,1230]]),
  joint:brackets([[22158,100],[52528,200],[82904,400],[115084,600],[145448,800],[742958,930],[891542,1030],[1485906,1130],[null,1230]]),
  head:brackets([[22173,100],[52530,200],[67716,400],[83805,600],[98990,800],[505208,930],[606251,1030],[1010417,1130],[null,1230]]),
};
const inflateBrackets=(items:readonly TaxBracket[],bps:number)=>items.map(x=>({...x,upToCents:x.upToCents===null?null:Math.round(x.upToCents*(1+bps/10000))}));

export const TAX_RULES_2025:TaxRulePack={year:2025,federal:{
  single:{standardDeductionCents:15750_00,brackets:brackets([[11925,1000],[48475,1200],[103350,2200],[197300,2400],[250525,3200],[626350,3500],[null,3700]])},
  "married-joint":{standardDeductionCents:31500_00,brackets:brackets([[23850,1000],[96950,1200],[206700,2200],[394600,2400],[501050,3200],[751600,3500],[null,3700]])},
  "married-separate":{standardDeductionCents:15750_00,brackets:brackets([[11925,1000],[48475,1200],[103350,2200],[197300,2400],[250525,3200],[375800,3500],[null,3700]])},
  "head-of-household":{standardDeductionCents:23625_00,brackets:brackets([[17000,1000],[64850,1200],[103350,2200],[197300,2400],[250500,3200],[626350,3500],[null,3700]])},
},california:{
  single:{standardDeductionCents:5706_00,brackets:ca2025.single},
  "married-joint":{standardDeductionCents:11412_00,brackets:ca2025.joint},
  "married-separate":{standardDeductionCents:5706_00,brackets:ca2025.single},
  "head-of-household":{standardDeductionCents:11412_00,brackets:ca2025.head},
},federalLongTermCapitalGains:{single:brackets([[48350,0],[533400,1500],[null,2000]]),"married-joint":brackets([[96700,0],[600050,1500],[null,2000]]),"married-separate":brackets([[48350,0],[300000,1500],[null,2000]]),"head-of-household":brackets([[64750,0],[566700,1500],[null,2000]])},unrecapturedSection1250MaxRateBps:2500,netInvestmentIncomeThresholdCents:{single:200000_00,"married-joint":250000_00,"married-separate":125000_00,"head-of-household":200000_00},socialSecurityWageBaseCents:176100_00,additionalMedicareThresholdCents:{single:200000_00,"married-joint":250000_00,"married-separate":125000_00,"head-of-household":200000_00},sources:sources(2025)};

export const TAX_RULES_2026:TaxRulePack={year:2026,federal:{
  single:{standardDeductionCents:16100_00,brackets:brackets([[12400,1000],[50400,1200],[105700,2200],[201775,2400],[256225,3200],[640600,3500],[null,3700]])},
  "married-joint":{standardDeductionCents:32200_00,brackets:brackets([[24800,1000],[100800,1200],[211400,2200],[403550,2400],[512450,3200],[768700,3500],[null,3700]])},
  "married-separate":{standardDeductionCents:16100_00,brackets:brackets([[12400,1000],[50400,1200],[105700,2200],[201775,2400],[256225,3200],[384350,3500],[null,3700]])},
  "head-of-household":{standardDeductionCents:24150_00,brackets:brackets([[17700,1000],[67450,1200],[105700,2200],[201750,2400],[256200,3200],[640600,3500],[null,3700]])},
},california:{
  single:{standardDeductionCents:Math.round(5706_00*1.025),brackets:inflateBrackets(ca2025.single,250)},
  "married-joint":{standardDeductionCents:Math.round(11412_00*1.025),brackets:inflateBrackets(ca2025.joint,250)},
  "married-separate":{standardDeductionCents:Math.round(5706_00*1.025),brackets:inflateBrackets(ca2025.single,250)},
  "head-of-household":{standardDeductionCents:Math.round(11412_00*1.025),brackets:inflateBrackets(ca2025.head,250)},
},federalLongTermCapitalGains:{single:brackets([[49450,0],[545500,1500],[null,2000]]),"married-joint":brackets([[98900,0],[613700,1500],[null,2000]]),"married-separate":brackets([[49450,0],[306850,1500],[null,2000]]),"head-of-household":brackets([[66200,0],[579600,1500],[null,2000]])},unrecapturedSection1250MaxRateBps:2500,netInvestmentIncomeThresholdCents:TAX_RULES_2025.netInvestmentIncomeThresholdCents,socialSecurityWageBaseCents:184500_00,additionalMedicareThresholdCents:TAX_RULES_2025.additionalMedicareThresholdCents,sources:sources(2026)};

function progressive(amount:Cents,items:readonly TaxBracket[]):Cents{let tax=0,previous=0;for(const item of items){const ceiling=item.upToCents??amount;tax+=Math.round(Math.max(0,Math.min(amount,ceiling)-previous)*item.rateBps/10000);if(amount<=ceiling)break;previous=ceiling;}return tax;}
function marginal(amount:Cents,items:readonly TaxBracket[]):number{if(amount<=0)return 0;return items.find(x=>x.upToCents===null||amount<=x.upToCents)?.rateBps??0;}
export function estimateTax(input:TaxabilityBreakdown,status:FilingStatus,pack:TaxRulePack,projected=false):TaxEstimate{
  for(const [name,value] of Object.entries(input)) if(!Number.isSafeInteger(value)||value<0) throw new RangeError(`${name} must be a non-negative safe integer number of cents`);
  if(input.federalDeductionCents>input.grossWageIncomeCents||input.californiaDeductionCents>input.grossWageIncomeCents||input.ficaExemptWagesCents>input.grossWageIncomeCents) throw new RangeError("Tax deductions and exempt wages cannot exceed gross wage income");
  const gross=Math.max(0,input.grossWageIncomeCents),fedDeduction=Math.max(0,Math.min(gross,input.federalDeductionCents)),caDeduction=Math.max(0,Math.min(gross,input.californiaDeductionCents)),ficaWages=Math.max(0,gross-Math.max(0,Math.min(gross,input.ficaExemptWagesCents))),fed=pack.federal[status],ca=pack.california[status];
  const federalTaxable=Math.max(0,gross-fedDeduction-fed.standardDeductionCents),caTaxable=Math.max(0,gross-caDeduction-ca.standardDeductionCents);
  const federalCents=progressive(federalTaxable,fed.brackets),californiaCents=progressive(caTaxable,ca.brackets);
  const socialSecurityCents=Math.round(Math.min(ficaWages,pack.socialSecurityWageBaseCents)*620/10000);
  const medicareCents=Math.round(ficaWages*145/10000)+Math.round(Math.max(0,ficaWages-pack.additionalMedicareThresholdCents[status])*90/10000);
  const totalCents=federalCents+californiaCents+socialSecurityCents+medicareCents;
  return {federalCents,californiaCents,socialSecurityCents,medicareCents,totalCents,effectiveRateBps:gross?Math.round(totalCents*10000/gross):0,marginalRateBps:marginal(federalTaxable,fed.brackets)+marginal(caTaxable,ca.brackets)+145+(ficaWages<pack.socialSecurityWageBaseCents?620:0)+(ficaWages>pack.additionalMedicareThresholdCents[status]?90:0),sourceYear:pack.year,projected:projected||pack.sources.some(x=>x.status==="projected"),sources:pack.sources};
}

const roundDollars=(cents:number)=>Math.round(cents/100)*100;
const roundHundreds=(cents:number)=>Math.round(cents/10_000)*10_000;
export function projectedTaxRules(year:number,thresholdInflationBps:number):TaxRulePack{
  if(year<=2025)return TAX_RULES_2025;
  if(year===2026)return TAX_RULES_2026;
  if(!Number.isInteger(year)||year>2100||thresholdInflationBps<0)throw new RangeError("Invalid projected tax-rule year or inflation rate");
  const factor=Math.pow(1+thresholdInflationBps/10_000,year-2026);
  const inflate=(items:readonly TaxBracket[])=>items.map(item=>({...item,upToCents:item.upToCents===null?null:roundDollars(item.upToCents*factor)}));
  const statuses=Object.keys(TAX_RULES_2026.federal) as FilingStatus[];
  const federal=Object.fromEntries(statuses.map(status=>[status,{standardDeductionCents:roundHundreds(TAX_RULES_2026.federal[status].standardDeductionCents*factor),brackets:inflate(TAX_RULES_2026.federal[status].brackets)}])) as unknown as TaxRulePack["federal"];
  const california=Object.fromEntries(statuses.map(status=>[status,{standardDeductionCents:roundDollars(TAX_RULES_2026.california[status].standardDeductionCents*factor),brackets:inflate(TAX_RULES_2026.california[status].brackets)}])) as unknown as TaxRulePack["california"];
  const federalLongTermCapitalGains=Object.fromEntries(statuses.map(status=>[status,inflate(TAX_RULES_2026.federalLongTermCapitalGains[status])])) as unknown as TaxRulePack["federalLongTermCapitalGains"];
  return {year:2026,federal,california,federalLongTermCapitalGains,unrecapturedSection1250MaxRateBps:TAX_RULES_2026.unrecapturedSection1250MaxRateBps,netInvestmentIncomeThresholdCents:TAX_RULES_2026.netInvestmentIncomeThresholdCents,socialSecurityWageBaseCents:roundHundreds(TAX_RULES_2026.socialSecurityWageBaseCents*factor),additionalMedicareThresholdCents:TAX_RULES_2026.additionalMedicareThresholdCents,sources:TAX_RULES_2026.sources.map(source=>({...source,status:"projected" as const}))};
}

function saltCap(year:number,agiCents:number,status:FilingStatus){
  if(year>=2030)return status==="married-separate"?5_000_00:10_000_00;
  const multiplier=Math.pow(1.01,Math.max(0,year-2025));
  const cap=roundHundreds((status==="married-separate"?20_000_00:40_000_00)*multiplier);
  const phaseStart=roundHundreds((status==="married-separate"?250_000_00:500_000_00)*multiplier);
  const floor=status==="married-separate"?5_000_00:10_000_00;
  return Math.max(floor,cap-Math.round(Math.max(0,agiCents-phaseStart)*540/10_000));
}

export function estimateHouseholdTax(args:{year:number;status:FilingStatus;employees:readonly EmployeeWages[];nonWageTaxableCents?:Cents;deductions?:Partial<HouseholdDeductions>;thresholdInflationBps:number;futureCashFlowRatioBps?:number}):TaxLedger{
  const {year,status}=args,employees=args.employees.map(employee=>({...employee}));
  if(status==="married-joint"&&new Set(employees.map(x=>x.personId)).size!==2)throw new RangeError("Married filing jointly requires two distinct employee/member owners");
  for(const employee of employees)for(const value of [employee.salaryCents,employee.rsuCents])if(!Number.isSafeInteger(value)||value<0)throw new RangeError("Employee wages must be non-negative safe integer cents");
  const pack=projectedTaxRules(year,args.thresholdInflationBps),wages=employees.reduce((sum,x)=>sum+x.salaryCents+x.rsuCents,0),nonWage=args.nonWageTaxableCents??0,d={traditionalRetirementCents:0,mortgageInterestCents:0,propertyTaxCents:0,...args.deductions};
  const agi=Math.max(0,wages+nonWage-d.traditionalRetirementCents),debtRatio=Math.min(1,750_000_00/(d.mortgageDebtCents||750_000_00));
  const federalMortgage=Math.round(d.mortgageInterestCents*debtRatio),federalItemized=federalMortgage+Math.min(d.propertyTaxCents+(d.stateIncomeTaxCents??0),saltCap(year,agi,status));
  const californiaItemized=d.mortgageInterestCents+d.propertyTaxCents;
  const federalDeduction=Math.max(pack.federal[status].standardDeductionCents,federalItemized),californiaDeduction=Math.max(pack.california[status].standardDeductionCents,californiaItemized);
  const federalTaxable=Math.max(0,agi-federalDeduction),californiaTaxable=Math.max(0,agi-californiaDeduction);
  const federalCents=progressive(federalTaxable,pack.federal[status].brackets),californiaCents=progressive(californiaTaxable,pack.california[status].brackets);
  const payroll=employees.map(employee=>{const employeeWages=employee.salaryCents+employee.rsuCents;return {...employee,socialSecurityCents:Math.round(Math.min(employeeWages,pack.socialSecurityWageBaseCents)*620/10_000),medicareCents:Math.round(employeeWages*145/10_000),sdiCents:Math.round(employeeWages*130/10_000)}});
  const socialSecurityCents=payroll.reduce((s,x)=>s+x.socialSecurityCents,0),baseMedicare=payroll.reduce((s,x)=>s+x.medicareCents,0),additionalMedicareCents=Math.round(Math.max(0,wages-pack.additionalMedicareThresholdCents[status])*90/10_000),sdiCents=payroll.reduce((s,x)=>s+x.sdiCents,0),fullYearLiabilityCents=federalCents+californiaCents+socialSecurityCents+baseMedicare+additionalMedicareCents+sdiCents;
  return {year,employees:payroll,grossIncomeCents:wages+nonWage,federalStandardCents:pack.federal[status].standardDeductionCents,federalItemizedCents:federalItemized,federalDeductionCents:federalDeduction,federalTaxableCents:federalTaxable,californiaStandardCents:pack.california[status].standardDeductionCents,californiaItemizedCents:californiaItemized,californiaDeductionCents:californiaDeduction,californiaTaxableCents:californiaTaxable,federalCents,californiaCents,socialSecurityCents,medicareCents:baseMedicare,additionalMedicareCents,sdiCents,fullYearLiabilityCents,futureCashFlowCents:Math.round(fullYearLiabilityCents*(args.futureCashFlowRatioBps??10_000)/10_000),refundOrBalanceDue:"unknown",sources:pack.sources,projected:year>2026||pack.sources.some(x=>x.status==="projected")};
}
