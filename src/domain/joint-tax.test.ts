import {describe,expect,it} from "vitest";
import {cliffQuarterlyVestEvents,holdingValue,projectedSharePrice,valueForUnits,vestedUnitsAt} from "./equity";
import {estimateHouseholdTax,projectedTaxRules,TAX_RULES_2025} from "./tax";
import type {EquityHolding} from "./types";

describe("joint 2026 payroll tax",()=>{
  it("caps Social Security per employee and leaves Medicare and SDI uncapped",()=>{
    const ledger=estimateHouseholdTax({year:2026,status:"married-joint",thresholdInflationBps:250,employees:[
      {personId:"spouse-a",salaryCents:155_000_00,rsuCents:112_043_75},
      {personId:"spouse-b",salaryCents:50_000_00,rsuCents:0},
    ]});
    expect(ledger.grossIncomeCents).toBe(317_043_75);
    expect(ledger.employees.map(x=>x.socialSecurityCents)).toEqual([11_439_00,3_100_00]);
    expect(ledger.socialSecurityCents).toBe(14_539_00);
    expect(ledger.medicareCents+ledger.additionalMedicareCents).toBe(5_200_52);
    expect(ledger.sdiCents).toBe(4_121_57);
    expect(ledger.refundOrBalanceDue).toBe("unknown");
  });
  it("requires two distinct owners for a joint unit",()=>expect(()=>estimateHouseholdTax({year:2026,status:"married-joint",thresholdInflationBps:250,employees:[{personId:"same",salaryCents:1,rsuCents:0},{personId:"same",salaryCents:1,rsuCents:0}]})).toThrow(/two distinct/));
});

describe("versioned rules and deductions",()=>{
  it("uses the official corrected California 2025 schedule",()=>expect(TAX_RULES_2025.california["married-joint"].brackets.slice(0,3).map(x=>x.upToCents)).toEqual([22_158_00,52_528_00,82_904_00]));
  it("freezes future thresholds until a reviewed rule pack ships",()=>{const future=projectedTaxRules(2030,300);expect(future.federal.single.standardDeductionCents).toBe(16_100_00);expect(future.additionalMedicareThresholdCents["married-joint"]).toBe(250_000_00);expect(future.sources.every(x=>x.status==="projected")).toBe(true)});
  it("selects itemized deductions independently and excludes state tax from California",()=>{const ledger=estimateHouseholdTax({year:2026,status:"married-joint",thresholdInflationBps:250,employees:[{personId:"a",salaryCents:200_000_00,rsuCents:0},{personId:"b",salaryCents:100_000_00,rsuCents:0}],deductions:{mortgageInterestCents:30_000_00,propertyTaxCents:20_000_00,stateIncomeTaxCents:20_000_00}});expect(ledger.federalDeductionCents).toBe(70_000_00);expect(ledger.californiaDeductionCents).toBe(50_000_00)});
});

describe("fixed-point multi-grant equity",()=>{
  const original=cliffQuarterlyVestEvents("original",6_500_000_000,"2026-09-01");
  const promotion=cliffQuarterlyVestEvents("promotion",1_813_000_000,"2027-09-01");
  const holding:EquityHolding={priceCents:6_895,priceDate:"2026-09-01",sellToCover:true,appreciationCurve:{startYear:2026,startRateBps:5000,endYear:2035,endRateBps:800},grants:[{id:"original",ownerPersonId:"spouse-a",grantDate:"2025-09-01",grantPriceCents:4_000,unitsMicros:6_500_000_000,vestEvents:original},{id:"promotion",ownerPersonId:"spouse-a",grantDate:"2026-09-01",grantPriceCents:6_895,unitsMicros:1_813_000_000,vestEvents:promotion}]};
  it("preserves fractional tranches and exact vest dates",()=>{expect(original[0]).toMatchObject({date:"2026-09-01",unitsMicros:1_625_000_000});expect(original[1].unitsMicros).toBe(406_250_000);expect(original.at(-1)?.date).toBe("2029-09-01");expect(vestedUnitsAt(holding.grants[0],"2026-08-31")).toBe(0);expect(vestedUnitsAt(holding.grants[0],"2026-09-01")).toBe(1_625_000_000)});
  it("pins the confirmed holding value and exact vest FMV",()=>{expect(holdingValue(holding)).toBe(57_318_135);expect(valueForUnits(original[0].unitsMicros,projectedSharePrice(holding,"2026-09-01"))).toBe(11_204_375);expect(promotion.filter(x=>x.date.startsWith("2026")).length).toBe(0)});
});
