import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioPlanningDialog } from "./ScenarioPlanningDialog";
import { testRepository, type Bootstrap, type ScenarioRecord } from "./repository";

describe("ScenarioPlanningDialog",()=>{
 it("edits ADU rental tax assumptions",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  data.assets=[{id:"home",householdId:"test",name:"Current home",valueCents:600_000_00,annualGrowthBps:300,housingCosts:{propertyTaxRateBps:100,insuranceMonthlyCents:200_00,insuranceAnnualGrowthBps:200,hoaMonthlyCents:0,hoaAnnualGrowthBps:0},revision:1}];
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"garage-adu",date:eventDate,type:"adu-build",assetId:"home",name:"Garage ADU",costCents:60_000_00,homeSquareFeet:1_500,aduSquareFeet:500,fundingAccountId:"cash",monthlyRentalIncomeCents:2_000_00,rentalIncomeGrowthBps:500}],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};
  const updateScenario=vi.fn();
  render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={{...testRepository,updateScenario}} focusedEventId="garage-adu" close={vi.fn()} refresh={vi.fn()}/>);

  expect(screen.getByLabelText("Completed and ready to rent")).toHaveValue(eventDate);
  expect(screen.getByRole("heading",{name:"Rental tax assumptions"})).toBeInTheDocument();
  expect(screen.getByText("25% automatic allocation")).toBeInTheDocument();
  expect(screen.getByText(/Complete ADU tax assumptions/)).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Include ADU rental income taxes, deductions, and depreciation"));
  fireEvent.change(screen.getByLabelText("ADU rental type"),{target:{value:"short-term"}});
  expect(screen.getByLabelText("Materially participate in the ADU rental")).toBeInTheDocument();
  expect(screen.queryByLabelText("Qualify as a real-estate professional")).not.toBeInTheDocument();
  expect(screen.getByText(/construction cost is the default ADU depreciable basis/)).toBeInTheDocument();
  expect(screen.getByText(/Planning estimate only/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button",{name:"Save event"}));
  expect(screen.getByRole("alert")).toHaveTextContent("Short-term ADU tax modeling requires a material-participation answer");

  fireEvent.change(screen.getByLabelText("Materially participate in the ADU rental"),{target:{value:"false"}});
  fireEvent.change(screen.getByLabelText("Shared-expense allocation override (%)"),{target:{value:"30"}});
  fireEvent.change(screen.getByLabelText("ADU depreciable basis override (USD)"),{target:{value:"75000"}});
  fireEvent.click(screen.getByRole("button",{name:"Save event"}));
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));

  await waitFor(()=>expect(updateScenario).toHaveBeenCalledWith(expect.objectContaining({
   events:[expect.objectContaining({
    id:"garage-adu",
    type:"adu-build",
    rentalTaxDetails:{
     rentalTaxModelingEnabled:true,
     rentalType:"short-term",
     rentalUseBpsOverride:3_000,
     buildingBasisCentsOverride:75_000_00,
     shortTermMaterialParticipation:false,
     mfsLivedApartAllYear:false,
    },
   })],
  })));
 });
 it("loads existing ADU rental tax answers and preserves blank overrides",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  data.assets=[{id:"home",householdId:"test",name:"Current home",valueCents:600_000_00,annualGrowthBps:300,housingCosts:{propertyTaxRateBps:100,insuranceMonthlyCents:200_00,insuranceAnnualGrowthBps:200,hoaMonthlyCents:0,hoaAnnualGrowthBps:0},revision:1}];
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"garage-adu",date:eventDate,type:"adu-build",assetId:"home",name:"Garage ADU",costCents:60_000_00,homeSquareFeet:1_500,aduSquareFeet:500,fundingAccountId:"cash",monthlyRentalIncomeCents:2_000_00,rentalIncomeGrowthBps:500,rentalTaxDetails:{rentalTaxModelingEnabled:true,rentalType:"long-term",rentalUseBpsOverride:null,buildingBasisCentsOverride:null,mfsLivedApartAllYear:false,longTermRealEstateProfessional:false,longTermMaterialParticipation:true}}],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};

  render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={testRepository} focusedEventId="garage-adu" close={vi.fn()} refresh={vi.fn()}/>);

  expect(screen.getByLabelText("Include ADU rental income taxes, deductions, and depreciation")).toBeChecked();
  expect(screen.getByLabelText("ADU rental type")).toHaveValue("long-term");
  expect(screen.getByLabelText("Shared-expense allocation override (%)")).toHaveValue("");
  expect(screen.getByLabelText("ADU depreciable basis override (USD)")).toHaveValue("");
  expect(screen.getByLabelText("Qualify as a real-estate professional")).toHaveValue("false");
  expect(screen.getByLabelText("Materially participate in the ADU rental")).toHaveValue("true");
  expect(screen.queryByText(/Complete ADU tax assumptions/)).not.toBeInTheDocument();
 });
 it("allows a zero-dollar ADU construction cost",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  data.assets=[{id:"home",householdId:"test",name:"Current home",valueCents:600_000_00,annualGrowthBps:300,housingCosts:{propertyTaxRateBps:100,insuranceMonthlyCents:200_00,insuranceAnnualGrowthBps:200,hoaMonthlyCents:0,hoaAnnualGrowthBps:0},revision:1}];
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"garage-adu",date:eventDate,type:"adu-build",assetId:"home",name:"Garage ADU",costCents:0,homeSquareFeet:1_500,aduSquareFeet:500,fundingAccountId:"cash",rentalIncomeGrowthBps:0}],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};
  const updateScenario=vi.fn();
  render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={{...testRepository,updateScenario}} focusedEventId="garage-adu" close={vi.fn()} refresh={vi.fn()}/>);

  expect(screen.queryByRole("heading",{name:"Rental tax assumptions"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Save event"}));
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));

  await waitFor(()=>expect(updateScenario).toHaveBeenCalled());
  expect(updateScenario.mock.calls[0][0].events[0].costCents).toBe(0);
 });
 it("preserves legacy ADU funding values without synthesizing rental tax details",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  data.assets=[{id:"home",householdId:"test",name:"Current home",valueCents:600_000_00,annualGrowthBps:300,housingCosts:{propertyTaxRateBps:100,insuranceMonthlyCents:200_00,insuranceAnnualGrowthBps:200,hoaMonthlyCents:0,hoaAnnualGrowthBps:0},revision:1}];
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"garage-adu",date:eventDate,type:"adu-build",assetId:"home",name:"Garage ADU",costCents:60_000_00,homeSquareFeet:1_500,aduSquareFeet:500,fundingAccountId:"cash",fundingSources:[{accountId:"cash",capCents:40_000_00}],monthlyRentalIncomeCents:2_000_00,rentalIncomeGrowthBps:500}],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};
  const updateScenario=vi.fn();
  render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={{...testRepository,updateScenario}} focusedEventId="garage-adu" close={vi.fn()} refresh={vi.fn()}/>);

  expect(screen.getByText(/Complete ADU tax assumptions/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Save event"}));
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));

  await waitFor(()=>expect(updateScenario).toHaveBeenCalled());
  const saved=updateScenario.mock.calls[0][0].events[0];
  expect(saved.fundingSources).toEqual([{accountId:"cash",capCents:40_000_00}]);
  expect(saved).not.toHaveProperty("rentalTaxDetails");
 });
 it("retains ADU rental tax drafts after a save failure and retries the same details",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  data.assets=[{id:"home",householdId:"test",name:"Current home",valueCents:600_000_00,annualGrowthBps:300,housingCosts:{propertyTaxRateBps:100,insuranceMonthlyCents:200_00,insuranceAnnualGrowthBps:200,hoaMonthlyCents:0,hoaAnnualGrowthBps:0},revision:1}];
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"garage-adu",date:eventDate,type:"adu-build",assetId:"home",name:"Garage ADU",costCents:60_000_00,homeSquareFeet:1_500,aduSquareFeet:500,fundingAccountId:"cash",monthlyRentalIncomeCents:2_000_00,rentalIncomeGrowthBps:500}],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};
  const updateScenario=vi.fn().mockRejectedValueOnce(new Error("ADU plan save failed")).mockResolvedValueOnce(undefined);
  render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={{...testRepository,updateScenario}} focusedEventId="garage-adu" close={vi.fn()} refresh={vi.fn()}/>);

  fireEvent.click(screen.getByLabelText("Include ADU rental income taxes, deductions, and depreciation"));
  fireEvent.change(screen.getByLabelText("ADU rental type"),{target:{value:"short-term"}});
  fireEvent.change(screen.getByLabelText("Materially participate in the ADU rental"),{target:{value:"false"}});
  fireEvent.change(screen.getByLabelText("Shared-expense allocation override (%)"),{target:{value:"30"}});
  fireEvent.change(screen.getByLabelText("ADU depreciable basis override (USD)"),{target:{value:"75000"}});
  fireEvent.click(screen.getByRole("button",{name:"Save event"}));
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));

  expect(await screen.findByRole("alert")).toHaveTextContent("ADU plan save failed");
  expect(updateScenario).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:/More options for ADU build/}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Edit"}));
  expect(screen.getByLabelText("ADU rental type")).toHaveValue("short-term");
  expect(screen.getByLabelText("Materially participate in the ADU rental")).toHaveValue("false");
  expect(screen.getByLabelText("Shared-expense allocation override (%)")).toHaveValue("30.00");
  expect(screen.getByLabelText("ADU depreciable basis override (USD)")).toHaveValue("75000.00");

  fireEvent.click(screen.getByRole("button",{name:"Save event"}));
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await waitFor(()=>expect(updateScenario).toHaveBeenCalledTimes(2));
  expect(updateScenario.mock.calls[1][0].events[0].rentalTaxDetails).toEqual(updateScenario.mock.calls[0][0].events[0].rentalTaxDetails);
  expect(updateScenario.mock.calls[1][0].events[0].rentalTaxDetails).toEqual({rentalTaxModelingEnabled:true,rentalType:"short-term",rentalUseBpsOverride:3_000,buildingBasisCentsOverride:75_000_00,mfsLivedApartAllYear:false,shortTermMaterialParticipation:false});
 });
 it("preserves nested purchase financing while editing and saves an ordered catch-all",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"buy",date:eventDate,type:"asset-purchase",assetId:"future-home",name:"Future home",valueCents:50000000,annualGrowthBps:300,fundingAccountId:"cash",downPaymentCents:10000000,costsCents:100000,financing:{liabilityId:"future-loan",name:"Mortgage",principalCents:40000000,annualRateBps:650,minimumPaymentCents:250000}}],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};
  const updateScenario=vi.fn();render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={{...testRepository,updateScenario}} close={vi.fn()} refresh={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:/More options for Asset purchase/}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Edit"}));
  expect(screen.getByLabelText("Debt name")).toHaveValue("Mortgage");
  expect(screen.getByLabelText("Selling costs (%)")).toHaveValue("");
  expect(screen.getByLabelText("Federal depreciation claimed")).toHaveValue("0.00");
  expect(screen.getByLabelText("California depreciation claimed")).toHaveValue("0.00");
  fireEvent.change(screen.getByLabelText("Selling costs (%)"),{target:{value:"6"}});
  fireEvent.click(screen.getByLabelText("Eligible for primary-home gain exclusion"));
  fireEvent.click(screen.getByRole("button",{name:"Save event"}));fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await waitFor(()=>expect(updateScenario).toHaveBeenCalledWith(expect.objectContaining({expectedRevision:4,events:[expect.objectContaining({financing:expect.objectContaining({liabilityId:"future-loan",principalCents:40000000}),propertyDetails:expect.objectContaining({homeSaleAssumptions:{sellingCostBps:600,primaryResidenceExclusionEligible:true,accumulatedFederalDepreciationCents:0,accumulatedCaliforniaDepreciationCents:0}})})],contributions:[]})));
 });
 it("keeps blank planned-home selling costs undefined",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"buy",date:eventDate,type:"asset-purchase",assetId:"future-home",name:"Future home",valueCents:50000000,annualGrowthBps:300,fundingAccountId:"cash",downPaymentCents:10000000,costsCents:100000}],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};
  const updateScenario=vi.fn();render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={{...testRepository,updateScenario}} close={vi.fn()} refresh={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:/More options for Asset purchase/}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Edit"}));
  expect(screen.getByLabelText("Selling costs (%)")).toHaveValue("");
  fireEvent.click(screen.getByRole("button",{name:"Save event"}));
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await waitFor(()=>expect(updateScenario).toHaveBeenCalled());
  const saved=updateScenario.mock.calls[0][0].events[0];
  expect(saved.propertyDetails.homeSaleAssumptions).toBeUndefined();
 });
 it("saves a fixed monthly contribution amount",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:1,events:[],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};
  const updateScenario=vi.fn();render(<ScenarioPlanningDialog record={record} bootstrap={data} projectedMonthlySurplusCents={7090_00} repository={{...testRepository,updateScenario}} close={vi.fn()} refresh={vi.fn()}/>);
  fireEvent.click(screen.getByRole("heading",{name:"Contributions"}).closest("section")!.querySelector("button")!);
  fireEvent.change(screen.getByLabelText("Contribution 1 method"),{target:{value:"amount"}});
  fireEvent.change(screen.getByLabelText("Contribution 1 monthly amount"),{target:{value:""}});
  expect(screen.getByLabelText("Contribution 1 monthly amount")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Contribution 1 monthly amount"),{target:{value:"583.33"}});
  expect(screen.getByText(/8\.23% of projected surplus assigned/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await waitFor(()=>expect(updateScenario).toHaveBeenCalledWith(expect.objectContaining({contributions:[expect.objectContaining({monthlyAmountCents:58333,percentBps:undefined,frequency:"monthly"})]})));
 });
});
