import { describe, expect, it } from "vitest";
import { buildRetirementCutoff } from "./retirementCutoff";
import { calculateRetirementSnapshot } from "./retirementSnapshot";
import type { FinancialSnapshot, Scenario } from "./types";
import type { Asset as RepositoryAsset } from "../repository";

const snapshot:FinancialSnapshot={
  household:{id:"household",name:"Household",state:"CA",people:[{id:"person",name:"Person"}]},
  taxProfile:{filingStatus:"single",state:"CA",taxYear:2026,thresholdInflationBps:250,taxUnit:{id:"single",filingStatus:"single",memberPersonIds:["person"]}},
  accounts:[{id:"cash",name:"Cash",kind:"checking",balanceCents:10_000,annualReturnBps:0,liquid:true}],
  recurring:[],
  assets:[
    {id:"home",name:"Home",valueCents:100_000,annualGrowthBps:0,housingCosts:{propertyTaxRateBps:0,insuranceMonthlyCents:0,insuranceAnnualGrowthBps:0,hoaMonthlyCents:0,hoaAnnualGrowthBps:0},purchasePriceCents:80_000,purchaseDate:"2020-01-01",homeSaleAssumptions:{sellingCostBps:600,primaryResidenceExclusionEligible:true,accumulatedFederalDepreciationCents:0,accumulatedCaliforniaDepreciationCents:0}},
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
    expect(cutoff.taxLedger).toEqual(expect.objectContaining({year:2027,federalAgiCents:0,modifiedAgiCents:0}));
  });

  it("carries pre-retirement rental taxable income and its tax into the cutoff",()=>{
    const rentalSnapshot:FinancialSnapshot={
      ...snapshot,
      accounts:[{...snapshot.accounts[0],balanceCents:0}],
      recurring:[{id:"salary",name:"Salary",kind:"income",incomeType:"salary",incomeTaxCategory:"wages",ownerPersonId:"person",amountCents:120_000_00,startDate:"2026-01-01",taxTreatment:"none"}],
      assets:[{...snapshot.assets[0],id:"rental",name:"Rental",valueCents:100_000_00}],
      liabilities:[],
    };
    const rentalScenario:Scenario={...scenario,events:[{id:"rent",date:"2026-01-01",type:"property-rental-start",assetId:"rental",name:"Rental income",monthlyRentalIncomeCents:1_000_00,rentalIncomeGrowthBps:0,rentalUseBps:10000,rentalTaxModelingEnabled:true,rentalType:"long-term",buildingBasisCents:0}]};
    const cutoff=buildRetirementCutoff({snapshot:rentalSnapshot,scenario:rentalScenario,retirementMonth:"2026-09",asOfDate:"2026-01-01"});

    expect(cutoff.taxLedger).toEqual(expect.objectContaining({
      federalAgiCents:88_000_00,
      modifiedAgiCents:88_000_00,
      federalTaxableCents:71_900_00,
      californiaTaxableCents:82_151_35,
      fullYearLiabilityCents:21_679_68,
    }));
    expect(cutoff.accounts.cash).toBe(66_320_32);
    expect(cutoff.properties[0]).toEqual(expect.objectContaining({monthlyGrossRentCents:1_000_00}));
  });

  it("includes an owner-occupied current home without rental events",()=>{
    const quietScenario:Scenario={...scenario,events:[]};
    const cutoff=buildRetirementCutoff({snapshot,scenario:quietScenario,retirementMonth:"2026-09",asOfDate:"2026-01-15"});

    expect(cutoff.properties).toContainEqual(expect.objectContaining({assetId:"home",name:"Home",valueCents:100_000,mortgageCents:0,monthlyGrossRentCents:0,projectedDepreciationCents:0,source:"current"}));
  });

  it("keeps a native-shaped ordinary asset in non-home net worth without synthesizing a property",()=>{
    const ordinaryAssetFromNative:RepositoryAsset={
      id:"car",
      householdId:"household",
      name:"Car",
      valueCents:25_000,
      annualGrowthBps:0,
      revision:1,
      housingCosts:{propertyTaxRateBps:0,insuranceMonthlyCents:0,insuranceAnnualGrowthBps:0,hoaMonthlyCents:0,hoaAnnualGrowthBps:0},
    };
    const snapshotWithCar:FinancialSnapshot={...snapshot,assets:[...snapshot.assets,ordinaryAssetFromNative]};
    const quietScenario:Scenario={...scenario,events:[]};
    const cutoff=buildRetirementCutoff({snapshot:snapshotWithCar,scenario:quietScenario,retirementMonth:"2026-09",asOfDate:"2026-01-15"});
    const result=calculateRetirementSnapshot({cutoff,snapshot:snapshotWithCar,scenario:quietScenario,withdrawalRateBps:300});

    expect(cutoff.assets.car).toBe(25_000);
    expect(cutoff.properties.map(property=>property.assetId)).toEqual(["home"]);
    expect(result.keepHomes.nonHomeNetWorthCents).toBe(26_800);
  });

  it("excludes planned properties that are not owned at the cutoff without mutating the Plan",()=>{
    const plan:Scenario={...scenario,events:[
      {id:"future-purchase",date:"2026-10-01",type:"asset-purchase",assetId:"future-home",name:"Future home",valueCents:50_000,annualGrowthBps:0,fundingAccountId:"cash",downPaymentCents:0,costsCents:0},
      {id:"sold-purchase",date:"2026-01-01",type:"asset-purchase",assetId:"sold-home",name:"Sold home",valueCents:40_000,annualGrowthBps:0,fundingAccountId:"cash",downPaymentCents:0,costsCents:0},
      {id:"sold-sale",date:"2026-07-01",type:"asset-sale",assetId:"sold-home",proceedsCents:0,costsCents:0,destinationAccountId:"cash"},
    ]};
    const before=JSON.stringify(plan);
    const cutoff=buildRetirementCutoff({snapshot,scenario:plan,retirementMonth:"2026-09",asOfDate:"2026-01-15"});

    expect(cutoff.properties.map(property=>property.assetId)).toEqual(["home"]);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("names a preceding month whose projection has no balance row",()=>{
    expect(()=>buildRetirementCutoff({snapshot,scenario,retirementMonth:"2026-03",asOfDate:"2026-03-15"})).toThrow(/2026-02/);
  });
});
