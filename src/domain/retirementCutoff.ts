import { ProjectionEngine } from "./projection";
import type { Cents, FinancialSnapshot, Scenario, TaxLedger } from "./types";

export interface RetirementCutoffInput {
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  retirementMonth: string;
  asOfDate: string;
}

export interface RetirementCutoffProperty {
  assetId: string;
  name: string;
  valueCents: Cents;
  mortgageCents: Cents;
  monthlyGrossRentCents: Cents;
  projectedDepreciationCents: Cents;
  source: "current" | "planned";
}

export interface RetirementCutoff {
  retirementMonth: string;
  balanceMonth: string;
  accounts: Readonly<Record<string, Cents>>;
  assets: Readonly<Record<string, Cents>>;
  liabilities: Readonly<Record<string, Cents>>;
  properties: readonly RetirementCutoffProperty[];
  taxLedger: TaxLedger;
}

const monthKey=(date:Date)=>`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;
const parseMonth=(month:string)=>{
  const date=new Date(`${month}-01T00:00:00Z`);
  if(!/^\d{4}-\d{2}$/.test(month)||Number.isNaN(date.valueOf())||monthKey(date)!==month)throw new RangeError(`Invalid month: ${month}`);
  return date;
};

export function buildRetirementCutoff(input:RetirementCutoffInput):RetirementCutoff{
  const retirementDate=parseMonth(input.retirementMonth);
  const balanceDate=new Date(Date.UTC(retirementDate.getUTCFullYear(),retirementDate.getUTCMonth()-1,1));
  const balanceMonth=monthKey(balanceDate);
  const asOfMonth=input.asOfDate.slice(0,7),asOfMonthDate=parseMonth(asOfMonth);
  const projectionMonths=(balanceDate.getUTCFullYear()-asOfMonthDate.getUTCFullYear())*12+balanceDate.getUTCMonth()-asOfMonthDate.getUTCMonth()+1;
  if(projectionMonths<1||projectionMonths>1200)throw new RangeError(`Missing projection balances for ${balanceMonth}`);

  const scenario={...input.scenario,horizon:{start:asOfMonth,months:projectionMonths},retirementExtension:true} as Scenario&{retirementExtension:true};
  const projections=ProjectionEngine.calculate(input.snapshot,scenario,input.asOfDate,{stopEmploymentMonth:input.retirementMonth});
  const balanceRow=projections.flatMap(year=>year.months).find(month=>month.month===balanceMonth);
  if(!balanceRow?.balances)throw new RangeError(`Missing projection balances for ${balanceMonth}`);
  const taxLedger=projections.find(year=>year.year===balanceDate.getUTCFullYear())?.taxLedger;
  if(!taxLedger)throw new RangeError(`Missing tax ledger for ${balanceMonth}`);

  const assets={...balanceRow.balances.assets,...Object.fromEntries(Object.entries(balanceRow.balances.privateStock).map(([id,value])=>[id,value.vestedCents]))};
  const projectedMonths=projections.flatMap(year=>year.months).filter(month=>month.month<=balanceMonth);
  const currentAssetIds=new Set(input.snapshot.assets.map(asset=>asset.id));
  const properties=balanceRow.properties.map(property=>({
    assetId:property.assetId,
    name:property.name,
    valueCents:property.assetValueCents??0,
    mortgageCents:property.mortgageBalanceCents??0,
    monthlyGrossRentCents:property.rentCents+property.aduIncomeCents,
    projectedDepreciationCents:projectedMonths.flatMap(month=>month.properties).filter(row=>row.assetId===property.assetId).reduce((sum,row)=>sum+row.depreciationCents,0),
    source:currentAssetIds.has(property.assetId)?"current" as const:"planned" as const,
  }));

  return {retirementMonth:input.retirementMonth,balanceMonth,accounts:balanceRow.balances.accounts,assets,liabilities:balanceRow.balances.liabilities,properties,taxLedger};
}
