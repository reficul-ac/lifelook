import { describe, expect, it } from "vitest";
import { appreciationRateForYear, californiaAssessedValue, effectiveContributionBps, ProjectionEngine, vestedAssetValue, vestedBpsAtDate } from "./projection";
import { estimateTax, TAX_RULES_2025 } from "./tax";
import type { FinancialSnapshot, Scenario } from "./types";

const snapshot: FinancialSnapshot = { household:{id:"h",name:"H",state:"CA",people:[]}, taxProfile:{filingStatus:"single",state:"CA",taxYear:2025,thresholdInflationBps:250}, accounts:[{id:"a",name:"Cash",kind:"checking",balanceCents:100_00,annualReturnBps:0,liquid:true}], recurring:[{id:"i",name:"Pay",kind:"income",amountCents:1000_00,startDate:"2025-01-01",taxTreatment:"none"},{id:"e",name:"Rent",kind:"expense",amountCents:400_00,startDate:"2025-01-01",taxTreatment:"none"}],assets:[],liabilities:[] };
const scenario: Scenario = {id:"s",name:"Base",assumptions:{inflationBps:0,thresholdInflationBps:250},assumptionsInherited:false,events:[],defaultContributionAccountId:"a",contributions:[],withdrawals:[],horizon:{start:"2025-01",months:12}};
const calculate=(financial:FinancialSnapshot=snapshot,planned:Scenario=scenario)=>ProjectionEngine.calculate(financial,planned,"2025-01-15");
describe("California assessed values",()=>{
  it("grows purchase value at the Proposition 13 cap instead of market appreciation",()=>{
    expect(californiaAssessedValue({valueCents:200_000_00,purchasePriceCents:100_000_00,purchaseDate:"2020-01-15"},"2025-01")).toBeCloseTo(11_040_808,-1);
  });
});
describe("asset appreciation curves",()=>{
  const asset={annualGrowthBps:1000,appreciationCurve:{startYear:2026,startRateBps:5000,endYear:2035,endRateBps:800}};
  it("interpolates yearly and holds the endpoint rates",()=>{
    expect(appreciationRateForYear(asset,2025)).toBe(5000);
    expect(appreciationRateForYear(asset,2026)).toBe(5000);
    expect(appreciationRateForYear(asset,2030)).toBe(3133);
    expect(appreciationRateForYear(asset,2035)).toBe(800);
    expect(appreciationRateForYear(asset,2045)).toBe(800);
  });
});
describe("private stock vesting",()=>{
  const asset={valueCents:800_00,privateStock:{vestedBps:2500,vestingStartDate:"2026-01-01",remainingVestingQuarters:16}};
  it("counts only vested value and vests the remainder evenly each quarter",()=>{
    expect(vestedAssetValue(asset,"2026-01-01")).toBe(200_00);
    expect(vestedBpsAtDate(asset,"2026-04-01")).toBe(2969);
    expect(vestedBpsAtDate(asset,"2030-01-01")).toBe(10000);
    expect(vestedAssetValue({...asset,valueCents:1_600_00},"2026-01-01")).toBe(400_00);
  });
});

describe("private stock tax on vest",()=>{
  it("taxes each quarterly vest only in the calendar year when it occurs",()=>{
    const financial:FinancialSnapshot={...snapshot,accounts:[{...snapshot.accounts[0],balanceCents:0}],recurring:[{id:"salary",name:"Household salary",kind:"income",amountCents:10_000_00,startDate:"2025-01-01",taxTreatment:"none"}],assets:[{id:"stock",name:"Stock",valueCents:400_000_00,annualGrowthBps:0,privateStock:{vestedBps:0,vestingStartDate:"2025-10-01",remainingVestingQuarters:4,taxOnVest:true}}]};
    const plan:Scenario={...scenario,horizon:{start:"2025-10",months:6}};
    const taxed=ProjectionEngine.calculate(financial,plan,"2025-10-15");
    const untaxed=ProjectionEngine.calculate({...financial,assets:[{...financial.assets[0],privateStock:{...financial.assets[0].privateStock!,taxOnVest:false}}]},plan,"2025-10-15");
    expect(taxed.find(year=>year.year===2025)?.taxCents).toBe(untaxed.find(year=>year.year===2025)?.taxCents);
    expect(taxed.find(year=>year.year===2026)!.taxCents).toBeGreaterThan(untaxed.find(year=>year.year===2026)!.taxCents);
    const january=taxed.find(year=>year.year===2026)!.months.find(month=>month.month==="2026-01")!;
    const untaxedJanuary=untaxed.find(year=>year.year===2026)!.months.find(month=>month.month==="2026-01")!;
    expect(january.taxCents).toBeGreaterThan(untaxedJanuary.taxCents);
    expect(january.balances!.privateStock.stock.vestedCents).toBeLessThan(untaxedJanuary.balances!.privateStock.stock.vestedCents);
    expect(taxed.find(year=>year.year===2026)!.months.filter(month=>month.taxCents>(untaxed.find(year=>year.year===2026)!.months.find(other=>other.month===month.month)?.taxCents??0)).map(month=>month.month)).toEqual(["2026-01"]);
  });
});

describe("Carriggs joint-income projection",()=>{
  const personA="a",personB="b",holding={priceCents:6895,priceDate:"2026-09-01",sellToCover:true,grants:[{id:"original",ownerPersonId:personA,grantDate:"2025-09-01",grantPriceCents:4000,unitsMicros:6_500_000_000,vestEvents:[{id:"cliff",date:"2026-09-01",unitsMicros:1_625_000_000,actualFmvCents:6895}]},{id:"promotion",ownerPersonId:personA,grantDate:"2026-09-01",grantPriceCents:6895,unitsMicros:1_813_000_000,vestEvents:[{id:"promo-cliff",date:"2027-09-01",unitsMicros:453_250_000}]}]};
  const financial:FinancialSnapshot={household:{id:"h",name:"H",state:"CA",people:[{id:personA,name:"Spouse A"},{id:personB,name:"Spouse B"}]},taxProfile:{filingStatus:"married-joint",state:"CA",taxYear:2026,thresholdInflationBps:250,taxUnit:{id:"joint",filingStatus:"married-joint",memberPersonIds:[personA,personB]}},accounts:[{id:"cash",name:"Cash",kind:"checking",balanceCents:10_000_00,annualReturnBps:0,liquid:true}],recurring:[{id:"a-pay",name:"A pay",kind:"income",incomeType:"salary",incomeTaxCategory:"wages",ownerPersonId:personA,amountCents:155_000_00,startDate:"2026-01-01",annualGrowthBps:1000,annualGrowthMonth:2,taxTreatment:"none"},{id:"b-pay",name:"B pay",kind:"income",incomeType:"salary",incomeTaxCategory:"wages",ownerPersonId:personB,amountCents:50_000_00,startDate:"2026-01-01",annualGrowthBps:0,taxTreatment:"none"}],assets:[{id:"equity",name:"PrivateCo",valueCents:57_318_135,annualGrowthBps:0,equityHolding:holding},{id:"home",name:"Home",valueCents:94_000_000,annualGrowthBps:700,housingCosts:{propertyTaxRateBps:125,insuranceMonthlyCents:20_000,insuranceAnnualGrowthBps:0,hoaMonthlyCents:0,hoaAnnualGrowthBps:0}}],liabilities:[{id:"mortgage",name:"Mortgage",balanceCents:63_007_405,annualRateBps:700,minimumPaymentCents:425_794,mortgage:{originalPrincipalCents:64_000_000,termMonths:360,startDate:"2025-02-07",assetId:"home"}}]};
  const plan:Scenario={...scenario,defaultContributionAccountId:"cash",horizon:{start:"2026-08",months:2}};
  it("uses full-year wages and housing deductions without charging elapsed taxes to opening cash",()=>{const [year]=ProjectionEngine.calculate(financial,plan,"2026-08-16"),ledger=year.taxLedger!;expect(ledger.grossIncomeCents).toBe(317_043_75);expect(ledger.socialSecurityCents).toBe(14_539_00);expect(ledger.medicareCents+ledger.additionalMedicareCents).toBe(5_200_52);expect(ledger.sdiCents).toBe(4_121_57);expect(ledger.californiaItemizedCents).toBe(55_914_51);expect(ledger.californiaDeductionCents).toBe(55_914_51);expect(ledger.californiaCents).toBe(16_984_24);expect(ledger.federalItemizedCents).toBe(72_898_75);expect(ledger.federalDeductionCents).toBe(72_898_75);expect(ledger.federalCents).toBe(43_790_80);expect(ledger.fullYearLiabilityCents).toBe(84_636_13);expect(year.months.filter(month=>month.status==="actual").every(month=>month.taxCents===0)).toBe(true)});
  it("adds only vested equity to net worth and uses sell-to-cover instead of double-charging cash",()=>{const [year]=ProjectionEngine.calculate(financial,plan,"2026-08-16"),august=year.months.find(month=>month.month==="2026-08")!,september=year.months.find(month=>month.month==="2026-09")!;expect(august.balances!.privateStock.equity.vestedCents).toBe(0);expect(september.balances!.privateStock.equity.vestedCents).toBeGreaterThan(0);expect(september.balances!.privateStock.equity.vestedCents).toBeLessThan(11_204_375);expect(september.surplusCents).toBe(september.incomeCents-september.expenseCents-(september.taxCents-(11_204_375-september.balances!.privateStock.equity.vestedCents)))});
  it("splits cash tax from RSU sell-to-cover so annual surplus reconciles",()=>{const [year]=ProjectionEngine.calculate(financial,plan,"2026-08-16");expect(year.rsuSellToCoverTaxCents).toBeGreaterThan(0);expect(year.taxCents).toBe(year.cashTaxCents+year.rsuSellToCoverTaxCents);expect(year.surplusCents).toBe(year.incomeCents-year.expenseCents-year.cashTaxCents);for(const month of year.months)expect(month.taxCents).toBe(month.cashTaxCents+month.rsuSellToCoverTaxCents)});
});

describe("retirement employment cutoff",()=>{
  it("stops household wages and RSU vesting at the retirement month",()=>{
    const personA="employee-a",personB="employee-b";
    const financialWithSeptemberWagesAndVests:FinancialSnapshot={
      household:{id:"household",name:"Household",state:"CA",people:[{id:personA,name:"Employee A"},{id:personB,name:"Employee B"}]},
      taxProfile:{filingStatus:"married-joint",state:"CA",taxYear:2026,thresholdInflationBps:250,taxUnit:{id:"joint",filingStatus:"married-joint",memberPersonIds:[personA,personB]}},
      accounts:[{id:"cash",name:"Cash",kind:"checking",balanceCents:0,annualReturnBps:0,liquid:true}],
      recurring:[
        {id:"a-salary",name:"A salary",kind:"income",incomeType:"salary",incomeTaxCategory:"wages",ownerPersonId:personA,amountCents:120_000_00,startDate:"2026-01-01",taxTreatment:"none"},
        {id:"b-salary",name:"B salary",kind:"income",incomeType:"salary",incomeTaxCategory:"wages",ownerPersonId:personB,amountCents:60_000_00,startDate:"2026-01-01",taxTreatment:"none"},
        {id:"royalties",name:"Royalties",kind:"income",incomeType:"ordinary",incomeTaxCategory:"taxable-nonwage",amountCents:500_00,frequency:"monthly",startDate:"2026-01-01",taxTreatment:"none"},
      ],
      assets:[{id:"rsu",name:"RSUs",valueCents:2_000,annualGrowthBps:0,equityHolding:{priceCents:1_000,priceDate:"2026-01-01",sellToCover:false,grants:[{id:"grant",ownerPersonId:personA,grantDate:"2026-01-01",grantPriceCents:1_000,unitsMicros:2_000_000,vestEvents:[{id:"august-vest",date:"2026-08-01",unitsMicros:1_000_000},{id:"september-vest",date:"2026-09-01",unitsMicros:1_000_000}]}]}}],
      liabilities:[],
    };
    const plan:Scenario={...scenario,defaultContributionAccountId:"cash",events:[{id:"september-bonus",date:"2026-09-01",type:"one-time-income",amountCents:1_000_00,incomeTaxCategory:"wages",ownerPersonId:personA}],horizon:{start:"2026-01",months:9}};
    const result=ProjectionEngine.calculate(financialWithSeptemberWagesAndVests,plan,"2026-01-01",{stopEmploymentMonth:"2026-09"});
    const year=result[0],august=year.months.find(month=>month.month==="2026-08")!,september=year.months.find(month=>month.month==="2026-09")!;
    const wagesThroughAugust:Record<string,number>={[personA]:80_000_00,[personB]:40_000_00};

    expect(august.incomeCents).toBeGreaterThan(0);
    expect(september.incomeCents).toBe(500_00);
    expect(year.taxLedger!.employees.every(employee=>employee.salaryCents===wagesThroughAugust[employee.personId])).toBe(true);
    expect(september.balances!.privateStock.rsu.vestedCents).toBe(1_000);
  });

  it("limits tax AGI to pre-retirement taxable months while non-wage cash flow continues",()=>{
    const financial:FinancialSnapshot={
      household:{id:"household",name:"Household",state:"CA",people:[{id:"employee",name:"Employee"}]},
      taxProfile:{filingStatus:"single",state:"CA",taxYear:2026,thresholdInflationBps:250,taxUnit:{id:"single",filingStatus:"single",memberPersonIds:["employee"]}},
      accounts:[{id:"cash",name:"Cash",kind:"checking",balanceCents:0,annualReturnBps:0,liquid:true}],
      recurring:[
        {id:"salary",name:"Salary",kind:"income",incomeType:"salary",incomeTaxCategory:"wages",ownerPersonId:"employee",amountCents:120_000_00,startDate:"2026-01-01",taxTreatment:"none"},
        {id:"royalties",name:"Royalties",kind:"income",incomeType:"ordinary",incomeTaxCategory:"taxable-nonwage",amountCents:500_00,frequency:"monthly",startDate:"2026-01-01",taxTreatment:"none"},
      ],
      assets:[],
      liabilities:[],
    };
    const plan:Scenario={...scenario,defaultContributionAccountId:"cash",horizon:{start:"2026-01",months:9}};
    const [year]=ProjectionEngine.calculate(financial,plan,"2026-01-01",{stopEmploymentMonth:"2026-09"});

    expect(year.months.find(month=>month.month==="2026-09")!.incomeCents).toBe(500_00);
    expect(year.taxLedger).toEqual(expect.objectContaining({federalAgiCents:84_000_00,modifiedAgiCents:84_000_00}));
  });

  it("includes a vest late in the preceding month in month-end balances",()=>{
    const financial:FinancialSnapshot={...snapshot,recurring:[],assets:[{id:"rsu",name:"RSUs",valueCents:1_000,annualGrowthBps:0,equityHolding:{priceCents:1_000,priceDate:"2026-01-01",sellToCover:false,grants:[{id:"grant",ownerPersonId:"employee",grantDate:"2026-01-01",grantPriceCents:1_000,unitsMicros:1_000_000,vestEvents:[{id:"late-august",date:"2026-08-31",unitsMicros:1_000_000}]}]}}]};
    const plan:Scenario={...scenario,horizon:{start:"2026-08",months:2}};
    const [year]=ProjectionEngine.calculate(financial,plan,"2026-08-01",{stopEmploymentMonth:"2026-09"});

    expect(year.months.find(month=>month.month==="2026-08")!.balances!.privateStock.rsu.vestedCents).toBe(1_000);
    expect(year.months.find(month=>month.month==="2026-09")!.balances!.privateStock.rsu.vestedCents).toBe(1_000);
  });
});

describe("ProjectionEngine",()=>{
  it("projects a funded planned property as an asset, mortgage, rent, costs, and tracker record",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:5_000_00}]};
    const purchase={id:"buy-home",date:"2025-01-01",type:"asset-purchase" as const,assetId:"future-home",name:"Future home",valueCents:10_000_00,annualGrowthBps:0,fundingAccountId:"a",fundingSources:[{accountId:"a"}],downPaymentCents:2_000_00,costsCents:500_00,housingCosts:{propertyTaxRateBps:120,insuranceMonthlyCents:10_00,insuranceAnnualGrowthBps:0,hoaMonthlyCents:5_00,hoaAnnualGrowthBps:0},financing:{liabilityId:"future-mortgage",name:"Future mortgage",principalCents:8_000_00,annualRateBps:0,minimumPaymentCents:100_00,termMonths:120},propertyDetails:{maintenanceBps:120,monthlyRentalIncomeCents:200_00,rentalIncomeGrowthBps:0,primaryResidence:false,rentalUseBps:10000,rentalTaxModelingEnabled:true}};
    const month=calculate(financial,{...scenario,events:[purchase],horizon:{start:"2025-01",months:1}})[0].months[0],property=month.properties[0];
    expect(property.status).toBe("active");expect(property.purchaseCashCents).toBe(2_500_00);expect(property.assetValueCents).toBe(10_000_00);expect(property.mortgageBalanceCents).toBe(7_900_00);expect(property.rentCents).toBe(200_00);expect(property.principalCents).toBe(100_00);expect(property.maintenanceCents).toBe(10_00);expect(month.balances!.assets["future-home"]).toBe(10_000_00);expect(month.balances!.liabilities["future-mortgage"]).toBe(7_900_00);
  });
  it("keeps an unfunded planned property unexecuted and reports its shortfall",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:100_00}]},purchase={id:"buy-home",date:"2025-01-01",type:"asset-purchase" as const,assetId:"future-home",name:"Future home",valueCents:10_000_00,annualGrowthBps:0,fundingAccountId:"a",downPaymentCents:2_000_00,costsCents:500_00};
    const month=calculate(financial,{...scenario,events:[purchase],horizon:{start:"2025-01",months:1}})[0].months[0],property=month.properties[0];
    expect(property.status).toBe("unfunded");expect(property.executionShortfallCents).toBe(2_400_00);expect(property.assetValueCents).toBeNull();expect(month.balances!.assets["future-home"]).toBeUndefined();expect(month.warnings[0].code).toBe("event-unfunded");
  });
  it("values an ADU from the home's projected pre-build value per square foot",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:100_000_00}]},purchase={id:"buy-home",date:"2025-01-01",type:"asset-purchase" as const,assetId:"future-home",name:"Future home",valueCents:100_000_00,annualGrowthBps:0,fundingAccountId:"a",downPaymentCents:20_000_00,costsCents:1_000_00,propertyDetails:{adu:{planned:true,costCents:10_000_00,homeSquareFeet:2000,squareFeet:500}}},adu={id:"build-adu",date:"2025-02-01",type:"adu-build" as const,assetId:"future-home",name:"Build ADU",costCents:10_000_00,homeSquareFeet:2000,aduSquareFeet:500,fundingAccountId:"a"};
    const result=calculate(financial,{...scenario,events:[purchase,adu],horizon:{start:"2025-01",months:2}}),february=result[0].months[1].properties[0],annual=result[0].properties[0];
    expect(february.aduCostCents).toBe(10_000_00);expect(february.aduAddedValueCents).toBe(25_000_00);expect(february.assetValueCents).toBe(125_000_00);expect(february.equityCents).toBe(125_000_00);expect(annual.aduAddedValueCents).toBe(25_000_00);
  });
  it("converts an owned home to a rental and tracks a scenario-only ADU without duplicating the asset",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:100_000_00}],assets:[{id:"owned-home",name:"Current home",valueCents:600_000_00,annualGrowthBps:0,housingCosts:{propertyTaxRateBps:0,insuranceMonthlyCents:0,insuranceAnnualGrowthBps:0,hoaMonthlyCents:0,hoaAnnualGrowthBps:0}}]},transition={id:"rent-home",date:"2025-02-01",type:"property-rental-start" as const,assetId:"owned-home",name:"Current home rental",monthlyRentalIncomeCents:3_000_00,rentalIncomeGrowthBps:0,rentalUseBps:10000,rentalTaxModelingEnabled:true,rentalType:"long-term" as const},adu={id:"owned-adu",date:"2025-03-01",type:"adu-build" as const,assetId:"owned-home",name:"Build ADU",costCents:80_000_00,homeSquareFeet:1500,aduSquareFeet:500,fundingAccountId:"a",monthlyRentalIncomeCents:2_000_00,rentalIncomeGrowthBps:0};
    const months=calculate(financial,{...scenario,events:[transition,adu],horizon:{start:"2025-01",months:3}})[0].months;
    expect(months[0].properties[0].status).toBe("owner-occupied");expect(months[0].properties[0].rentCents).toBe(0);expect(months[1].properties[0].status).toBe("active");expect(months[1].incomeCents).toBe(3_000_00);expect(months[2].properties[0].aduAddedValueCents).toBe(200_000_00);expect(months[2].incomeCents).toBe(5_000_00);expect(Object.keys(months[2].balances!.assets)).toEqual(["owned-home"]);
  });
  it("tracks ADU rent and value for a current home without requiring a whole-home rental conversion",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:100_000_00}],assets:[{id:"home",name:"Home",valueCents:600_000_00,annualGrowthBps:0,housingCosts:{propertyTaxRateBps:0,insuranceMonthlyCents:0,insuranceAnnualGrowthBps:0,hoaMonthlyCents:0,hoaAnnualGrowthBps:0}}]},adu={id:"adu",date:"2025-02-01",type:"adu-build" as const,assetId:"home",name:"Garage ADU",costCents:60_000_00,homeSquareFeet:1500,aduSquareFeet:500,fundingAccountId:"a",monthlyRentalIncomeCents:2_000_00,rentalIncomeGrowthBps:0};
    const result=calculate(financial,{...scenario,events:[adu],horizon:{start:"2025-01",months:2}})[0],february=result.months[1].properties[0];
    expect(february.status).toBe("owner-occupied");expect(february.aduAddedValueCents).toBe(200_000_00);expect(february.aduIncomeCents).toBe(2_000_00);expect(february.assetValueCents).toBe(800_000_00);expect(result.properties[0].aduIncomeCents).toBe(2_000_00);
  });
  it("combines fixed amounts and remaining-surplus percentages for the displayed assignment",()=>{
    expect(effectiveContributionBps([{id:"fixed",destinationType:"account",destinationId:"a",monthlyAmountCents:1250_00,frequency:"monthly"}],7090_00)).toBe(1763);
    expect(effectiveContributionBps([{id:"fixed",destinationType:"account",destinationId:"a",monthlyAmountCents:2500,frequency:"monthly"},{id:"percent",destinationType:"account",destinationId:"b",percentBps:5000,frequency:"monthly"}],10000)).toBe(6250);
    expect(effectiveContributionBps([{id:"fixed",destinationType:"account",destinationId:"a",monthlyAmountCents:20000,frequency:"monthly"}],10000)).toBe(10000);
  });
  it("splits total surplus by fixed contribution shares and keeps the remainder in cash",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0},{...snapshot.accounts[0],id:"invest",name:"Invest",kind:"investment" as const,liquid:false,balanceCents:0}]};
    const plan:Scenario={...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income",amountCents:100_00}],contributions:[{id:"half",destinationType:"account",destinationId:"invest",percentBps:5000,frequency:"monthly"}],horizon:{start:"2025-01",months:1}};
    const month=calculate(financial,plan)[0].months[0];
    expect(month.contributionCents).toBe(Math.floor(month.surplusCents/2));
    expect(month.balances!.accounts.a+month.balances!.accounts.invest).toBe(month.surplusCents);
  });
  it("reserves fixed monthly amounts before percentages divide the remaining surplus",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0},{...snapshot.accounts[0],id:"roth",name:"Roth",kind:"retirement" as const,liquid:false,balanceCents:0},{...snapshot.accounts[0],id:"brokerage",name:"Brokerage",kind:"investment" as const,liquid:false,balanceCents:0}]};
    const plan:Scenario={...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income",amountCents:100_00}],contributions:[{id:"roth-fixed",destinationType:"account",destinationId:"roth",monthlyAmountCents:30_00,frequency:"monthly"},{id:"half-rest",destinationType:"account",destinationId:"brokerage",percentBps:5000,frequency:"monthly"}],horizon:{start:"2025-01",months:1}};
    const month=calculate(financial,plan)[0].months[0],remaining=month.surplusCents-30_00;
    expect(month.balances!.accounts.roth).toBe(30_00);
    expect(month.balances!.accounts.brokerage).toBe(Math.floor(remaining/2));
    expect(month.balances!.accounts.a).toBe(remaining-Math.floor(remaining/2));
  });
  it("limits a fixed monthly contribution to positive surplus",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0},{...snapshot.accounts[0],id:"roth",name:"Roth",kind:"retirement" as const,liquid:false,balanceCents:0}]};
    const plan:Scenario={...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income",amountCents:10_00}],contributions:[{id:"roth-fixed",destinationType:"account",destinationId:"roth",monthlyAmountCents:50_00,frequency:"monthly"}],horizon:{start:"2025-01",months:1}};
    const month=calculate(financial,plan)[0].months[0];
    expect(month.balances!.accounts.roth).toBe(month.surplusCents);expect(month.balances!.accounts.a).toBe(0);
  });
  it("accepts nullable database fields after a fixed contribution save and refresh",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0},{...snapshot.accounts[0],id:"roth",name:"Roth",kind:"retirement" as const,liquid:false,balanceCents:0}]};
    const persistedRule={id:"roth-fixed",destinationType:"account",destinationId:"roth",percentBps:null,monthlyAmountCents:25_00,frequency:"monthly",targetBalanceCents:null,overflowDestinationType:null,overflowDestinationId:null};
    const plan={...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income" as const,amountCents:50_00}],contributions:[persistedRule],horizon:{start:"2025-01",months:1}} as unknown as Scenario;
    expect(()=>calculate(financial,plan)).not.toThrow();
    expect(calculate(financial,plan)[0].months[0].balances!.accounts.roth).toBe(25_00);
  });
  it("applies mortgage contributions as extra principal without increasing expenses",()=>{
    const financial={...snapshot,recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0}],liabilities:[{id:"mortgage",name:"Mortgage",balanceCents:100_00,annualRateBps:0,minimumPaymentCents:10_00,mortgage:{originalPrincipalCents:100_00,termMonths:12,startDate:"2025-01-01",assetId:"home"}}]};
    const plan:Scenario={...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income",amountCents:50_00}],contributions:[{id:"extra",destinationType:"mortgage",destinationId:"mortgage",percentBps:10000,frequency:"monthly"}],horizon:{start:"2025-01",months:1}};
    const month=calculate(financial,plan)[0].months[0];
    expect(month.expenseCents).toBe(10_00);expect(month.contributionCents).toBe(month.surplusCents);expect(month.debtCents).toBe(90_00-month.surplusCents);
  });
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
  it("automatically includes the full linked-home carrying cost once",()=>{
    const financial={...snapshot,recurring:[],assets:[{id:"home",name:"Home",valueCents:600_000_00,annualGrowthBps:0,housingCosts:{propertyTaxRateBps:120,insuranceMonthlyCents:200_00,insuranceAnnualGrowthBps:0,hoaMonthlyCents:50_00,hoaAnnualGrowthBps:0}}],liabilities:[{id:"mortgage",name:"Mortgage",balanceCents:400_000_00,annualRateBps:0,minimumPaymentCents:2_000_00,mortgage:{originalPrincipalCents:400_000_00,termMonths:360,startDate:"2025-01-01",assetId:"home"}}]};
    const month=calculate(financial,{...scenario,horizon:{start:"2025-01",months:1}})[0].months[0];
    expect(month.principalAndInterestCents).toBe(2_000_00);
    expect(month.housingCostCents).toBe(600_00+200_00+50_00);
    expect(month.expenseCents).toBe(2_000_00+600_00+200_00+50_00);
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
  it("exposes entity balances after all monthly projection activity",()=>{
    const financial={...snapshot,accounts:[{...snapshot.accounts[0],balanceCents:1000}],assets:[{id:"home",name:"Home",valueCents:2000,annualGrowthBps:0},{id:"equity",name:"Equity",valueCents:4000,annualGrowthBps:0,privateStock:{vestedBps:2500,vestingStartDate:"2025-01-01",remainingVestingQuarters:4}}],liabilities:[{id:"loan",name:"Loan",balanceCents:1000,annualRateBps:0,minimumPaymentCents:100}],recurring:[]};
    const month=calculate(financial,{...scenario,events:[{id:"add",date:"2025-01-01",type:"account-contribution" as const,accountId:"a",amountCents:500}],horizon:{start:"2025-01",months:1}})[0].months[0];
    expect(month.balances).toEqual({accounts:{a:1500},assets:{home:2000},privateStock:{equity:{vestedCents:1000,unvestedCents:3000}},liabilities:{loan:900}});
    expect(month.netWorthCents).toBe(1500+2000+1000-900-100);
  });
  it.each([["weekly",5],["biweekly",3],["monthly",1],["quarterly",1],["annual",1]] as const)("generates %s occurrences from calendar dates",(frequency,count)=>{
    const financial={...snapshot,recurring:[{id:"r",name:"Cadence",kind:"income" as const,amountCents:100,frequency,startDate:"2025-01-01",endDate:"2025-01-31",taxTreatment:"none" as const}]};
    const [year]=calculate(financial,{...scenario,horizon:{start:"2025-01",months:1}});
    expect(year.incomeCents).toBe(count*100);
  });
  it("distributes an annual salary across twelve monthly cash-flow periods",()=>{
    const financial={...snapshot,recurring:[{id:"salary",name:"Salary",kind:"income" as const,incomeType:"salary" as const,amountCents:120_000_01,frequency:"monthly" as const,startDate:"2025-01-01",taxTreatment:"none" as const}]};
    const year=calculate(financial)[0];
    expect(year.incomeCents).toBe(120_000_01);
    expect(year.months[0].incomeCents).toBe(10_000_01);
    expect(year.months.slice(1).every(month=>month.incomeCents===10_000_00)).toBe(true);
  });
  it("stops annual salary growth at the optional salary cap",()=>{
    const financial={...snapshot,accounts:[{...snapshot.accounts[0],balanceCents:0}],recurring:[{id:"salary",name:"Salary",kind:"income" as const,incomeType:"salary" as const,amountCents:100_000_00,frequency:"monthly" as const,startDate:"2025-01-01",annualGrowthBps:1000,annualGrowthMonth:1,annualGrowthCapCents:115_000_00,taxTreatment:"none" as const}]};
    const result=calculate(financial,{...scenario,horizon:{start:"2025-01",months:36}});
    expect(result[0].incomeCents).toBe(100_000_00);
    expect(result[1].incomeCents).toBe(110_000_00);
    expect(result[2].incomeCents).toBe(115_000_00);
  });
  it("keeps capped contribution overflow in default cash",()=>{
    const financial={...snapshot,taxProfile:{...snapshot.taxProfile,filingStatus:"single" as const},recurring:[],accounts:[{...snapshot.accounts[0],balanceCents:0},{...snapshot.accounts[0],id:"b",balanceCents:0}]};
    const planned:Scenario={...scenario,events:[{id:"cash",date:"2025-01-01",type:"one-time-income" as const,amountCents:1000}],contributions:[{id:"capped",destinationType:"account",destinationId:"b",percentBps:10000,frequency:"monthly",targetBalanceCents:200}],horizon:{start:"2025-01",months:1}};
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
