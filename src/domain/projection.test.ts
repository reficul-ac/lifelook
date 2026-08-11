import { describe, expect, it } from "vitest";
import { ProjectionEngine, requiredMonthlyFunding } from "./projection";
import { estimateTax, TAX_RULES_2025 } from "./tax";
import type { FinancialSnapshot, Scenario } from "./types";

const snapshot: FinancialSnapshot = { household:{id:"h",name:"H",state:"CA",people:[]}, taxProfile:{filingStatus:"single",state:"CA",taxYear:2025,thresholdInflationBps:250}, accounts:[{id:"a",name:"Cash",kind:"checking",balanceCents:100_00,annualReturnBps:0,liquid:true}], recurring:[{id:"i",name:"Pay",kind:"income",amountCents:1000_00,startDate:"2025-01-01",taxTreatment:"none"},{id:"e",name:"Rent",kind:"expense",amountCents:400_00,startDate:"2025-01-01",taxTreatment:"none"}],assets:[],liabilities:[] };
const scenario: Scenario = {id:"s",name:"Base",assumptions:{inflationBps:0,thresholdInflationBps:250},assumptionsInherited:false,events:[],allocations:[],withdrawals:[],goals:[],horizon:{start:"2025-01",months:12}};
const calculate=(financial:FinancialSnapshot=snapshot,planned:Scenario=scenario)=>ProjectionEngine.calculate(financial,planned,"2025-01-15");

describe("ProjectionEngine",()=>{
  it("uses straight-line and future-value goal funding formulas",()=>{
    expect(requiredMonthlyFunding(1200,12,0)).toBe(100);
    expect(requiredMonthlyFunding(1200,12,1200)).toBeLessThan(100);
    expect(requiredMonthlyFunding(1200,12,-1200)).toBeGreaterThan(100);
    expect(requiredMonthlyFunding(1200,0,1200)).toBe(1200);
  });
  it("funds ordered goals before ordinary surplus allocations",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0},{...snapshot.accounts[0],id:"goal",name:"Goal",kind:"savings" as const,balanceCents:0}]};
    const planned={...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income" as const,amountCents:1200}],allocations:[{accountId:"a",priority:1,percentBps:10000}],goals:[{id:"g",scenarioId:"s",type:"major-purchase" as const,name:"Purchase",priority:1,enabled:true,targetDate:"2025-12-15",purchaseDate:"2025-12-15",todayDollarBasis:true,startingEarmarkedCents:0,allowCashShortfall:false,revision:1,costCents:1200,destinationAccountId:"goal"}],horizon:{start:"2025-01",months:1}};
    const month=calculate(financial,planned)[0].months[0];
    expect(month.goalFundingCents).toBe(100);
    expect(month.allocationCents).toBe(month.surplusCents-100);
    expect(month.goalResults[0]).toMatchObject({fundedCents:100,shortfallCents:0,targetResult:"outside-horizon"});
  });
  it("rejects combined earmarks above a shared account balance",()=>{
    const common={scenarioId:"s",type:"major-purchase" as const,enabled:true,targetDate:"2025-12-01",purchaseDate:"2025-12-01",todayDollarBasis:true,allowCashShortfall:false,revision:1,costCents:100,destinationAccountId:"a"};
    const goals=[{...common,id:"g1",name:"One",priority:1,startingEarmarkedCents:60_00},{...common,id:"g2",name:"Two",priority:2,startingEarmarkedCents:60_00}];
    expect(()=>calculate(snapshot,{...scenario,goals})).toThrow(/earmarks/);
  });
  it("keeps debt payoff funding earmarked instead of executing a payoff",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0},{...snapshot.accounts[0],id:"reserve",name:"Reserve",balanceCents:0}],liabilities:[{id:"loan",name:"Loan",balanceCents:1200,annualRateBps:0,minimumPaymentCents:0}]};
    const goal={id:"debt-goal",scenarioId:"s",type:"debt-payoff" as const,name:"Loan reserve",priority:1,enabled:true,targetDate:"2025-12-01",todayDollarBasis:false,startingEarmarkedCents:0,allowCashShortfall:false,revision:1,liabilityId:"loan",destinationAccountId:"reserve"};
    const month=calculate(financial,{...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income" as const,amountCents:1200}],goals:[goal],horizon:{start:"2025-01",months:1}})[0].months[0];
    expect(month.goalFundingCents).toBe(100);expect(month.debtCents).toBe(1200);expect(month.goalResults[0].earmarkedCents).toBe(100);
  });
  it("does not fund disabled goals",()=>{const goal={id:"off",scenarioId:"s",type:"major-purchase" as const,name:"Off",priority:1,enabled:false,targetDate:"2025-12-01",purchaseDate:"2025-12-01",todayDollarBasis:false,startingEarmarkedCents:0,allowCashShortfall:false,revision:1,costCents:1200,destinationAccountId:"a"};expect(calculate(snapshot,{...scenario,goals:[goal]})[0].goalFundingCents).toBe(0)});
  it("keeps annual and monthly totals consistent",()=>{ const [year]=calculate(); expect(year.incomeCents).toBe(year.months.reduce((s,m)=>s+m.incomeCents,0)); expect(year.surplusCents).toBe(year.months.reduce((s,m)=>s+m.surplusCents,0)); });
  it("applies mid-year events only from their date",()=>{ const changed={...scenario,events:[{id:"x",type:"income-change" as const,date:"2025-07-01",entryId:"i",amountCents:2000_00}]}; const [year]=calculate(snapshot,changed); expect(year.months[5].incomeCents).toBe(1000_00); expect(year.months[6].incomeCents).toBe(2000_00); });
  it("sorts recurring changes deterministically rather than trusting payload order",()=>{ const events=[{id:"later",type:"income-change" as const,date:"2025-07-02",entryId:"i",amountCents:3000_00},{id:"earlier",type:"income-change" as const,date:"2025-07-01",entryId:"i",amountCents:2000_00}]; const [year]=calculate(snapshot,{...scenario,events}); expect(year.months[6].incomeCents).toBe(3000_00); });
  it("rejects horizons beyond forty years",()=>expect(()=>calculate(snapshot,{...scenario,horizon:{start:"2025-01",months:481}})).toThrow(/480/));
  it("does not mutate its inputs",()=>{ const before=JSON.stringify(snapshot); calculate(); expect(JSON.stringify(snapshot)).toBe(before); });
  it("amortizes liabilities independently and includes actual payments in cash flow",()=>{
    const financial={...snapshot,liabilities:[
      {id:"loan",name:"Loan",balanceCents:1000_00,annualRateBps:1200,minimumPaymentCents:100_00},
      {id:"small",name:"Small",balanceCents:50_00,annualRateBps:0,minimumPaymentCents:100_00},
    ]};
    const [year]=calculate(financial,{...scenario,horizon:{...scenario.horizon,months:1}});
    expect(year.months[0].debtCents).toBe(910_00);
    expect(year.months[0].expenseCents).toBe(550_00);
    expect(year.expenseCents).toBe(550_00);
  });
  it("grows assets at their individual rates",()=>{
    const financial={...snapshot,assets:[
      {id:"still",name:"Still",valueCents:100_00,annualGrowthBps:0},
      {id:"growing",name:"Growing",valueCents:100_00,annualGrowthBps:1200},
    ]};
    const oneMonth={...scenario,horizon:{...scenario.horizon,months:1}};
    const [year]=calculate(financial,oneMonth);
    const [withoutAssets]=calculate({...snapshot,assets:[]},oneMonth);
    const expected=100_00+Math.round(100_00*Math.pow(1.12,1/12));
    expect(year.months[0].netWorthCents!-withoutAssets.months[0].netWorthCents!).toBe(expected);
  });
  it.each([["weekly",5],["biweekly",3],["monthly",1],["quarterly",1],["annual",1]] as const)("generates %s occurrences from calendar dates",(frequency,count)=>{
    const financial={...snapshot,recurring:[{id:"r",name:"Cadence",kind:"income" as const,amountCents:100,frequency,startDate:"2025-01-01",endDate:"2025-01-31",taxTreatment:"none" as const}]};
    const [year]=calculate(financial,{...scenario,horizon:{start:"2025-01",months:1}});
    expect(year.incomeCents).toBe(count*100);
  });
  it("applies target waterfalls to remaining surplus",()=>{
    const financial={...snapshot,taxProfile:{...snapshot.taxProfile,filingStatus:"single" as const},recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0},{...snapshot.accounts[0],id:"b",balanceCents:0}]};
    const planned={...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income" as const,amountCents:1000}],allocations:[{accountId:"a",priority:1,percentBps:5000,targetBalanceCents:200},{accountId:"b",priority:2,percentBps:10000}],horizon:{start:"2025-01",months:1}};
    const [year]=calculate(financial,planned);
    expect(year.liquidWorthCents).toBe(year.surplusCents);
  });
  it("reports deficits without silently reducing account balances",()=>{
    const financial={...snapshot,recurring:[{id:"bill",name:"Bill",kind:"expense" as const,amountCents:500,frequency:"monthly" as const,startDate:"2025-01-01",taxTreatment:"none" as const}]};
    const [year]=calculate(financial,{...scenario,horizon:{start:"2025-01",months:1}});
    expect(year.unfundedDeficitCents).toBe(500);
    expect(year.months[0].warnings).toHaveLength(1);
  });
  it("prepends completed current-year ledger months without fabricating balances",()=>{
    const financial={...snapshot,actuals:[{date:"2025-01-10",kind:"income" as const,amountCents:12345},{date:"2025-01-11",kind:"transfer" as const,amountCents:99999}]};
    const years=ProjectionEngine.calculate(financial,{...scenario,horizon:{start:"2025-03",months:1}},"2025-03-15");
    expect(years[0].months.slice(0,2).map(month=>month.status)).toEqual(["actual","actual"]);
    expect(years[0].months[0]).toMatchObject({incomeCents:12345,expenseCents:0,netWorthCents:null,liquidWorthCents:null,debtCents:null});
  });
  it("draws deficits in priority order and returns structured warnings",()=>{
    const financial={...snapshot,accounts:[{...snapshot.accounts[0],balanceCents:200}],recurring:[{id:"bill",name:"Bill",kind:"expense" as const,amountCents:500,startDate:"2025-01-01",taxTreatment:"none" as const}]};
    const [year]=calculate(financial,{...scenario,withdrawals:[{accountId:"a",priority:1}],horizon:{start:"2025-01",months:1}});
    expect(year.unfundedDeficitCents).toBe(300);
    expect(year.warnings.map(warning=>warning.code)).toEqual(["account-depleted","unfunded-deficit"]);
  });
});
describe("tax estimates",()=>{ const wages=(grossWageIncomeCents:number)=>({grossWageIncomeCents,federalDeductionCents:0,californiaDeductionCents:0,ficaExemptWagesCents:0}); it("is zero with no income",()=>expect(estimateTax(wages(0),"single",TAX_RULES_2025).totalCents).toBe(0)); it("calculates bracket boundaries deterministically",()=>{ const estimate=estimateTax(wages(15750_00+11925_00),"single",TAX_RULES_2025); expect(estimate.federalCents).toBe(1192_50); expect(estimate.socialSecurityCents).toBeGreaterThan(0); }); });
