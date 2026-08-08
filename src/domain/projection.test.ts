import { describe, expect, it } from "vitest";
import { ProjectionEngine } from "./projection";
import { estimateTax, TAX_RULES_2025 } from "./tax";
import type { FinancialSnapshot, Scenario } from "./types";

const snapshot: FinancialSnapshot = { household:{id:"h",name:"H",state:"CA",people:[]}, taxProfile:{filingStatus:"single",state:"CA",taxYear:2025,thresholdInflationBps:250}, accounts:[{id:"a",name:"Cash",kind:"checking",balanceCents:100_00,annualReturnBps:0,liquid:true}], recurring:[{id:"i",name:"Pay",kind:"income",amountCents:1000_00,startDate:"2025-01-01"},{id:"e",name:"Rent",kind:"expense",amountCents:400_00,startDate:"2025-01-01"}],assets:[],liabilities:[] };
const scenario: Scenario = {id:"s",name:"Base",assumptions:{inflationBps:0,thresholdInflationBps:250},events:[],allocations:[],horizon:{start:"2025-01",months:12}};

describe("ProjectionEngine",()=>{
  it("keeps annual and monthly totals consistent",()=>{ const [year]=ProjectionEngine.calculate(snapshot,scenario); expect(year.incomeCents).toBe(year.months.reduce((s,m)=>s+m.incomeCents,0)); expect(year.surplusCents).toBe(year.months.reduce((s,m)=>s+m.surplusCents,0)); });
  it("applies mid-year events only from their date",()=>{ const changed={...scenario,events:[{id:"x",type:"income-change" as const,date:"2025-07-01",entryId:"i",amountCents:2000_00}]}; const [year]=ProjectionEngine.calculate(snapshot,changed); expect(year.months[5].incomeCents).toBe(1000_00); expect(year.months[6].incomeCents).toBe(2000_00); });
  it("rejects horizons beyond forty years",()=>expect(()=>ProjectionEngine.calculate(snapshot,{...scenario,horizon:{start:"2025-01",months:481}})).toThrow(/480/));
  it("does not mutate its inputs",()=>{ const before=JSON.stringify(snapshot); ProjectionEngine.calculate(snapshot,scenario); expect(JSON.stringify(snapshot)).toBe(before); });
});
describe("tax estimates",()=>{ it("is zero with no income",()=>expect(estimateTax(0,"single",TAX_RULES_2025).totalCents).toBe(0)); it("calculates bracket boundaries deterministically",()=>{ const estimate=estimateTax(15000_00+11925_00,"single",TAX_RULES_2025); expect(estimate.federalCents).toBe(1192_50); expect(estimate.socialSecurityCents).toBeGreaterThan(0); }); });
