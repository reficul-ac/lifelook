import { describe, expect, it } from "vitest";
import { buildRetirementCutoff } from "./retirementCutoff";
import type { FinancialSnapshot, Scenario } from "./types";

const snapshot:FinancialSnapshot={
  household:{id:"household",name:"Household",state:"CA",people:[{id:"person",name:"Person"}]},
  taxProfile:{filingStatus:"single",state:"CA",taxYear:2026,thresholdInflationBps:250,taxUnit:{id:"single",filingStatus:"single",memberPersonIds:["person"]}},
  accounts:[{id:"cash",name:"Cash",kind:"checking",balanceCents:10_000,annualReturnBps:0,liquid:true}],
  recurring:[],
  assets:[
    {id:"home",name:"Home",valueCents:100_000,annualGrowthBps:0,housingCosts:{propertyTaxRateBps:0,insuranceMonthlyCents:0,insuranceAnnualGrowthBps:0,hoaMonthlyCents:0,hoaAnnualGrowthBps:0}},
    {id:"rsu",name:"RSUs",valueCents:4_000,annualGrowthBps:0,privateStock:{vestedBps:2500,vestingStartDate:"2030-01-01",remainingVestingQuarters:4}},
  ],
  liabilities:[{id:"card",name:"Card",balanceCents:10_000,annualRateBps:0,minimumPaymentCents:100}],
};

const scenario:Scenario={
  id:"scenario",
  name:"Scenario",
  assumptions:{inflationBps:0,thresholdInflationBps:250},
  assumptionsInherited:false,
  events:[
    {id:"rental",date:"2026-01-01",type:"property-rental-start",assetId:"home",name:"Home rental",monthlyRentalIncomeCents:300,rentalIncomeGrowthBps:0,rentalUseBps:10000,rentalTaxModelingEnabled:true,rentalType:"long-term",buildingBasisCents:33_000},
    {id:"adu",date:"2026-01-01",type:"adu-build",assetId:"home",name:"ADU",costCents:0,homeSquareFeet:4,aduSquareFeet:1,fundingAccountId:"cash",monthlyRentalIncomeCents:100,rentalIncomeGrowthBps:0},
  ],
  defaultContributionAccountId:"cash",
  contributions:[],
  withdrawals:[],
  horizon:{start:"2026-01",months:2},
};

describe("buildRetirementCutoff",()=>{
  it("normalizes the preceding month's balances, property income, and tax ledger",()=>{
    const cutoff=buildRetirementCutoff({snapshot,scenario,retirementMonth:"2026-09",asOfDate:"2026-01-15"});

    expect(cutoff.balanceMonth).toBe("2026-08");
    expect(cutoff.accounts.cash).toBe(12_400);
    expect(cutoff.assets.home).toBe(125_000);
    expect(cutoff.assets.rsu).toBe(1_000);
    expect(cutoff.liabilities.card).toBe(9_200);
    expect(cutoff.taxLedger.year).toBe(2026);
    expect(cutoff.properties[0]).toEqual(expect.objectContaining({assetId:"home",monthlyGrossRentCents:400,projectedDepreciationCents:800,source:"current"}));
  });

  it("reads December when retirement starts in January",()=>{
    const cutoff=buildRetirementCutoff({snapshot,scenario,retirementMonth:"2027-01",asOfDate:"2026-01-15"});

    expect(cutoff.balanceMonth).toBe("2026-12");
    expect(cutoff.accounts.cash).toBe(13_600);
    expect(cutoff.taxLedger.year).toBe(2026);
  });

  it("names a preceding month whose projection has no balance row",()=>{
    expect(()=>buildRetirementCutoff({snapshot,scenario,retirementMonth:"2026-03",asOfDate:"2026-03-15"})).toThrow(/2026-02/);
  });
});
