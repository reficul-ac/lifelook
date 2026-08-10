import type { Cents, FilingStatus, TaxBracket, TaxEstimate, TaxRulePack, TaxSource } from "./types";

const IRS_URL="https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill";
const FTB_URL="https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html";
const SSA_URL="https://www.ssa.gov/oact/cola/cbb.html";
const brackets=(values:[number|null,number][]):TaxBracket[]=>values.map(([value,rateBps])=>({upToCents:value===null?null:value*100,rateBps}));
const sources=(year:2025|2026):TaxSource[]=>[
  {jurisdiction:"federal",sourceYear:year,status:"official",url:IRS_URL},
  {jurisdiction:"california",sourceYear:2025,status:year===2025?"official":"projected",url:FTB_URL},
  {jurisdiction:"payroll",sourceYear:year,status:"official",url:SSA_URL},
];

const ca2025={
  single:brackets([[11104,100],[26325,200],[41595,400],[57795,600],[73001,800],[372363,930],[446840,1030],[744732,1130],[null,1230]]),
  joint:brackets([[22208,100],[52650,200],[83190,400],[115590,600],[146002,800],[744726,930],[893680,1030],[1489464,1130],[null,1230]]),
  head:brackets([[22209,100],[52655,200],[67907,400],[84108,600],[99318,800],[506645,930],[607972,1030],[1013291,1130],[null,1230]]),
};
const inflateBrackets=(items:readonly TaxBracket[],bps:number)=>items.map(x=>({...x,upToCents:x.upToCents===null?null:Math.round(x.upToCents*(1+bps/10000))}));

export const TAX_RULES_2025:TaxRulePack={year:2025,federal:{
  single:{standardDeductionCents:15000_00,brackets:brackets([[11925,1000],[48475,1200],[103350,2200],[197300,2400],[250525,3200],[626350,3500],[null,3700]])},
  "married-joint":{standardDeductionCents:30000_00,brackets:brackets([[23850,1000],[96950,1200],[206700,2200],[394600,2400],[501050,3200],[751600,3500],[null,3700]])},
  "married-separate":{standardDeductionCents:15000_00,brackets:brackets([[11925,1000],[48475,1200],[103350,2200],[197300,2400],[250525,3200],[375800,3500],[null,3700]])},
  "head-of-household":{standardDeductionCents:22500_00,brackets:brackets([[17000,1000],[64850,1200],[103350,2200],[197300,2400],[250500,3200],[626350,3500],[null,3700]])},
},california:{
  single:{standardDeductionCents:5706_00,brackets:ca2025.single},
  "married-joint":{standardDeductionCents:11412_00,brackets:ca2025.joint},
  "married-separate":{standardDeductionCents:5706_00,brackets:ca2025.single},
  "head-of-household":{standardDeductionCents:11412_00,brackets:ca2025.head},
},socialSecurityWageBaseCents:176100_00,additionalMedicareThresholdCents:{single:200000_00,"married-joint":250000_00,"married-separate":125000_00,"head-of-household":200000_00},sources:sources(2025)};

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
},socialSecurityWageBaseCents:184500_00,additionalMedicareThresholdCents:TAX_RULES_2025.additionalMedicareThresholdCents,sources:sources(2026)};

function progressive(amount:Cents,items:readonly TaxBracket[]):Cents{let tax=0,previous=0;for(const item of items){const ceiling=item.upToCents??amount;tax+=Math.round(Math.max(0,Math.min(amount,ceiling)-previous)*item.rateBps/10000);if(amount<=ceiling)break;previous=ceiling;}return tax;}
function marginal(amount:Cents,items:readonly TaxBracket[]):number{if(amount<=0)return 0;return items.find(x=>x.upToCents===null||amount<=x.upToCents)?.rateBps??0;}
export function estimateTax(grossCents:Cents,status:FilingStatus,pack:TaxRulePack,pretaxCents=0,projected=false):TaxEstimate{
  const wages=Math.max(0,grossCents-pretaxCents),fed=pack.federal[status],ca=pack.california[status];
  const federalTaxable=Math.max(0,wages-fed.standardDeductionCents),caTaxable=Math.max(0,wages-ca.standardDeductionCents);
  const federalCents=progressive(federalTaxable,fed.brackets),californiaCents=progressive(caTaxable,ca.brackets);
  const socialSecurityCents=Math.round(Math.min(wages,pack.socialSecurityWageBaseCents)*620/10000);
  const medicareCents=Math.round(wages*145/10000)+Math.round(Math.max(0,wages-pack.additionalMedicareThresholdCents[status])*90/10000);
  const totalCents=federalCents+californiaCents+socialSecurityCents+medicareCents;
  return {federalCents,californiaCents,socialSecurityCents,medicareCents,totalCents,effectiveRateBps:wages?Math.round(totalCents*10000/wages):0,marginalRateBps:marginal(federalTaxable,fed.brackets)+marginal(caTaxable,ca.brackets)+145+(wages<pack.socialSecurityWageBaseCents?620:0)+(wages>pack.additionalMedicareThresholdCents[status]?90:0),sourceYear:pack.year,projected:projected||pack.sources.some(x=>x.status==="projected"),sources:pack.sources};
}
