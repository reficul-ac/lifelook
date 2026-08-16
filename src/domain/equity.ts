import type { AppreciationCurve, Cents, EquityHolding, RsuGrant, RsuVestEvent } from "./types";

export const UNITS_SCALE=1_000_000;
const DAY_MS=86_400_000;
const date=(value:string)=>{const parsed=new Date(`${value}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||parsed.toISOString().slice(0,10)!==value)throw new RangeError(`Invalid date: ${value}`);return parsed;};
const addMonths=(value:string,months:number)=>{const source=date(value),day=source.getUTCDate(),result=new Date(Date.UTC(source.getUTCFullYear(),source.getUTCMonth()+months,1));result.setUTCDate(Math.min(day,new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate()));return result.toISOString().slice(0,10);};
const rateAt=(curve:AppreciationCurve,year:number)=>year<=curve.startYear?curve.startRateBps:year>=curve.endYear?curve.endRateBps:curve.startRateBps+(curve.endRateBps-curve.startRateBps)*(year-curve.startYear)/(curve.endYear-curve.startYear);

export function valueForUnits(unitsMicros:number,priceCents:Cents){
  if(!Number.isSafeInteger(unitsMicros)||unitsMicros<0||!Number.isSafeInteger(priceCents)||priceCents<0)throw new RangeError("Units and price must be non-negative safe integers");
  return Math.round(unitsMicros*priceCents/UNITS_SCALE);
}
export function projectedSharePrice(holding:Pick<EquityHolding,"priceCents"|"priceDate"|"appreciationCurve">,onDate:string):Cents{
  const start=date(holding.priceDate),end=date(onDate);if(end<=start)return holding.priceCents;if(!holding.appreciationCurve)return holding.priceCents;
  let value=holding.priceCents,cursor=start;
  while(cursor<end){const nextYear=new Date(Date.UTC(cursor.getUTCFullYear()+1,0,1)),stop=nextYear<end?nextYear:end,days=(stop.valueOf()-cursor.valueOf())/DAY_MS;value*=Math.pow(1+rateAt(holding.appreciationCurve,cursor.getUTCFullYear())/10_000,days/365.2425);cursor=stop;}
  return Math.round(value);
}
export function vestValue(holding:EquityHolding,event:RsuVestEvent){return valueForUnits(event.unitsMicros,event.actualFmvCents??projectedSharePrice(holding,event.date));}
export function holdingValue(holding:EquityHolding,onDate=holding.priceDate){return holding.grants.reduce((sum,grant)=>sum+valueForUnits(grant.unitsMicros,projectedSharePrice(holding,onDate)),0);}
export function vestedUnitsAt(grant:RsuGrant,onDate:string){return grant.vestEvents.filter(event=>event.date<=onDate).reduce((sum,event)=>sum+event.unitsMicros,0);}
export function sellToCoverUnits(taxCents:Cents,priceCents:Cents){return Math.ceil(taxCents*UNITS_SCALE/priceCents);}

export function cliffQuarterlyVestEvents(grantId:string,unitsMicros:number,cliffDate:string,quarterCount=12):RsuVestEvent[]{
  if(!Number.isSafeInteger(unitsMicros)||unitsMicros<=0||quarterCount<=0)throw new RangeError("Grant units and quarter count must be positive integers");
  const cliff=Math.round(unitsMicros/4),remaining=unitsMicros-cliff,events:RsuVestEvent[]=[{id:`${grantId}-cliff`,date:cliffDate,unitsMicros:cliff}];
  let assigned=0;for(let index=1;index<=quarterCount;index++){const cumulative=Math.round(remaining*index/quarterCount),units=cumulative-assigned;assigned=cumulative;events.push({id:`${grantId}-q${index}`,date:addMonths(cliffDate,index*3),unitsMicros:units});}
  return events;
}
