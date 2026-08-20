import { ProjectionEngine } from "./projection";
import type { BasisPoints, Cents, FinancialSnapshot, Scenario, TaxLedger } from "./types";

export type PlannedPropertyPurchase = Extract<Scenario["events"][number], { type: "asset-purchase" }>;

export function latestOwnedPlannedPurchase(
  scenario: Scenario,
  assetId: string,
  beforeDateExclusive: string,
): PlannedPropertyPurchase | undefined {
  let owned: PlannedPropertyPurchase | undefined;
  const events = scenario.events
    .filter((event) =>
      event.date < beforeDateExclusive &&
      "assetId" in event &&
      event.assetId === assetId &&
      (event.type === "asset-purchase" || event.type === "asset-sale"))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (const event of events) owned = event.type === "asset-purchase" ? event : undefined;
  return owned;
}

export function isCurrentPropertyAsset(
  snapshot: FinancialSnapshot,
  scenario: Scenario,
  assetId: string,
  beforeDateExclusive: string,
): boolean {
  const asset = snapshot.assets.find((item) => item.id === assetId);
  if (!asset) return false;
  const propertyEvent = scenario.events.some((event) =>
    event.date < beforeDateExclusive &&
    "assetId" in event &&
    event.assetId === assetId &&
    (event.type === "property-rental-start" || event.type === "adu-build"));
  return Boolean(
    asset.housingCosts ||
    asset.housingStartDate != null ||
    asset.homeSaleAssumptions != null ||
    asset.rentalTaxBasisCents != null ||
    asset.rentalLandBasisCents != null ||
    asset.rentalBuildingBasisCents != null ||
    asset.rentalPlacedInServiceDate != null ||
    asset.federalPassiveLossCarryforwardCents != null ||
    asset.californiaPassiveLossCarryforwardCents != null ||
    snapshot.liabilities.some((liability) => liability.mortgage?.assetId === assetId) ||
    propertyEvent
  );
}

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
  liabilityId?: string;
  mortgageCents: Cents;
  monthlyGrossRentCents: Cents;
  monthlyAduRentCents?: Cents;
  rentalUseBps?: BasisPoints;
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
  const retirementYear=retirementDate.getUTCFullYear();
  let taxLedger=projections.find(year=>year.year===retirementYear)?.taxLedger;
  if(!taxLedger&&retirementYear!==balanceDate.getUTCFullYear()){
    const retirementScenario={...input.scenario,horizon:{start:input.retirementMonth,months:1},retirementExtension:true} as Scenario&{retirementExtension:true};
    taxLedger=ProjectionEngine.calculate(input.snapshot,retirementScenario,`${input.retirementMonth}-01`,{stopEmploymentMonth:input.retirementMonth}).find(year=>year.year===retirementYear)?.taxLedger;
  }
  if(!taxLedger)throw new RangeError(`Missing tax ledger for ${balanceMonth}`);

  const assets={...balanceRow.balances.assets,...Object.fromEntries(Object.entries(balanceRow.balances.privateStock).map(([id,value])=>[id,value.vestedCents]))};
  const projectedMonths=projections.flatMap(year=>year.months).filter(month=>month.month<=balanceMonth);
  const currentAssetIds=new Set(input.snapshot.assets.map(asset=>asset.id));
  const ownedAssetIds=new Set(Object.keys(balanceRow.balances.assets));
  const currentProperties=input.snapshot.assets.filter(asset=>isCurrentPropertyAsset(input.snapshot,input.scenario,asset.id,`${input.retirementMonth}-01`));
  const plannedPropertyIds=[...new Set(input.scenario.events.flatMap(event=>event.type==="asset-purchase"?[event.assetId]:[]))];
  const latestPlannedProperties=plannedPropertyIds.flatMap(assetId=>{
    const purchase=latestOwnedPlannedPurchase(input.scenario,assetId,`${input.retirementMonth}-01`);
    return purchase?[purchase]:[];
  });
  const propertyIds=[...new Set([...currentProperties.map(asset=>asset.id),...latestPlannedProperties.map(event=>event.assetId)])].filter(assetId=>ownedAssetIds.has(assetId));
  const properties=propertyIds.map(assetId=>{
    const current=input.snapshot.assets.find(asset=>asset.id===assetId),planned=latestOwnedPlannedPurchase(input.scenario,assetId,`${input.retirementMonth}-01`),propertyRows=balanceRow.properties.filter(row=>row.assetId===assetId),property=planned?.financing?propertyRows.filter(row=>row.liabilityId===planned.financing!.liabilityId).at(-1)??propertyRows.at(-1):propertyRows.at(-1);
    const liabilityId=property?.liabilityId??input.snapshot.liabilities.find(liability=>liability.mortgage?.assetId===assetId)?.id??planned?.financing?.liabilityId;
    const rentalStart=input.scenario.events.filter((event):event is Extract<Scenario["events"][number],{type:"property-rental-start"}>=>event.type==="property-rental-start"&&event.assetId===assetId&&event.date<`${input.retirementMonth}-01`).sort((left,right)=>left.date.localeCompare(right.date)||left.id.localeCompare(right.id)).at(-1);
    return {
      assetId,
      name:property?.name??current?.name??planned!.name,
      valueCents:balanceRow.balances!.assets[assetId],
      liabilityId,
      mortgageCents:property?.mortgageBalanceCents??(liabilityId?balanceRow.balances!.liabilities[liabilityId]??0:0),
      monthlyGrossRentCents:(property?.rentCents??0)+(property?.aduIncomeCents??0),
      monthlyAduRentCents:property?.aduIncomeCents??0,
      rentalUseBps:currentAssetIds.has(assetId)?rentalStart?.rentalUseBps:planned?.propertyDetails?.rentalUseBps,
      projectedDepreciationCents:projectedMonths.reduce((sum,month)=>{if(planned&&month.month<planned.date.slice(0,7))return sum;const rows=month.properties.filter(row=>row.assetId===assetId),row=planned?.financing?rows.filter(item=>item.liabilityId===planned.financing!.liabilityId).at(-1)??rows.at(-1):rows.at(-1);return sum+(row?.depreciationCents??0)},0),
      source:currentAssetIds.has(assetId)?"current" as const:"planned" as const,
    };
  });

  return {retirementMonth:input.retirementMonth,balanceMonth,accounts:balanceRow.balances.accounts,assets,liabilities:balanceRow.balances.liabilities,properties,taxLedger};
}
