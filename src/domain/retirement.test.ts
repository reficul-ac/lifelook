import { describe,expect,it } from "vitest";
import { ageOnDate,calculateRetirementOutlook,defaultRetirementPlan,rmdStartAge,uniformLifetimeFactor,type RetirementPlanRecord } from "./retirement";
import type { RetirementCalculationInput } from "./retirement";

const scenario={id:"s",name:"Base",assumptions:{inflationBps:250,thresholdInflationBps:250},assumptionsInherited:false,events:[],contributions:[],withdrawals:[],horizon:{start:"2026-01",months:180}} as const;
const account={id:"brokerage",name:"Brokerage",kind:"investment" as const,balanceCents:10_000_000,annualReturnBps:0,liquid:true,ownerPersonId:"p",subtype:"taxable-brokerage" as const,taxableCostBasisCents:8_000_000};
const record=(patch:Partial<RetirementPlanRecord>={}):RetirementPlanRecord=>({...defaultRetirementPlan(2030),householdId:"h",selectedScenarioId:"s",retirementYears:{p:2030},expenseBuckets:[{id:"living",name:"Living",mode:"annual",annualCents:1_200_000}],...patch});
const input=(plan=record()):RetirementCalculationInput&{people:{id:string;name:string;birthDate?:string}[]}=>({plan,currentYear:2026,scenario,accounts:[account],assets:[],liabilities:[],people:[{id:"p",name:"Pat",birthDate:"1970-07-01"}],projections:[{year:2030,months:[{month:"2030-12",balances:{accounts:{brokerage:10_000_000},assets:{},privateStock:{},liabilities:{}},properties:[]}]}] as never});

describe("retirement rule boundaries",()=>{
  it("uses the actual 59½ date",()=>{expect(ageOnDate("1970-07-01","2030-01-01")).toBeCloseTo(59.5,2);expect(ageOnDate("1970-07-01","2029-12-31")).toBeLessThan(59.5)});
  it("uses cohort RMD ages and Uniform Lifetime factors",()=>{expect(rmdStartAge("1959-01-01")).toBe(73);expect(rmdStartAge("1960-01-01")).toBe(75);expect(uniformLifetimeFactor(73)).toBe(26.5);expect(uniformLifetimeFactor(75)).toBe(24.6)});
});

describe("retirement audit forecast",()=>{
  it("hands off at December 31 and runs exactly 50 years",()=>{const result=calculateRetirementOutlook(input());expect(result.cutoffYear).toBe(2030);expect(result.firstRetirementYear).toBe(2031);expect(result.years).toHaveLength(50);expect(result.years.at(-1)?.year).toBe(2080)});
  it("withholds readiness instead of falling back to current balances",()=>{const value=input();value.projections=[];const result=calculateRetirementOutlook(value);expect(result.ready).toBeNull();expect(result.cutoffAccountBalanceCents).toBe(0);expect(result.missingData[0]).toContain("December 31, 2030")});
  it("uses the later legacy member year for household retirement",()=>{const value=input(record({retirementYears:{p:2030,partner:2033}}));value.people.push({id:"partner",name:"Partner",birthDate:"1972-01-01"});const result=calculateRetirementOutlook(value);expect(result.cutoffYear).toBe(2033);expect(result.ready).toBeNull()});
  it("reconciles account ledgers to the cent",()=>{const result=calculateRetirementOutlook(input());expect(result.years.every(year=>year.reconciliationDifferenceCents===0)).toBe(true);expect(result.years[0].beginningSpendableCents).toBe(10_000_000);expect(result.years[0].netWorthCents).toBe(result.years[0].totalAssetsCents-result.years[0].totalDebtCents)});
  it("requires positive spending and tax metadata",()=>{const value=input(record({expenseBuckets:[]}));value.accounts=[{...account,ownerPersonId:null,taxableCostBasisCents:null}];const result=calculateRetirementOutlook(value);expect(result.complete).toBe(false);expect(result.missingData.join(" ")).toMatch(/owner|required|basis|budget/i)});
  it("normalizes empty tax assumptions from older persisted plans",()=>{const value=input(record({taxAssumptions:{} as RetirementPlanRecord["taxAssumptions"]}));expect(()=>calculateRetirementOutlook(value)).not.toThrow();expect(calculateRetirementOutlook(value).years).toHaveLength(50)});
});
