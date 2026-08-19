import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioPlanningDialog } from "./ScenarioPlanningDialog";
import { testRepository, type Bootstrap, type ScenarioRecord } from "./repository";

describe("ScenarioPlanningDialog",()=>{
 it("preserves nested purchase financing while editing and saves an ordered catch-all",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"buy",date:eventDate,type:"asset-purchase",assetId:"future-home",name:"Future home",valueCents:50000000,annualGrowthBps:300,fundingAccountId:"cash",downPaymentCents:10000000,costsCents:100000,financing:{liabilityId:"future-loan",name:"Mortgage",principalCents:40000000,annualRateBps:650,minimumPaymentCents:250000}}],defaultContributionAccountId:"cash",contributions:[],withdrawals:[]};
  const updateScenario=vi.fn();render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={{...testRepository,updateScenario}} close={vi.fn()} refresh={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:/More options for Asset purchase/}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Edit"}));
  expect(screen.getByLabelText("Debt name")).toHaveValue("Mortgage");
  fireEvent.click(screen.getByRole("button",{name:"Save event"}));fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await waitFor(()=>expect(updateScenario).toHaveBeenCalledWith(expect.objectContaining({expectedRevision:4,events:[expect.objectContaining({financing:expect.objectContaining({liabilityId:"future-loan",principalCents:40000000})})],contributions:[]})));
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
