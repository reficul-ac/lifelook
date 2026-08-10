import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioPlanningDialog } from "./ScenarioPlanningDialog";
import { testRepository, type Bootstrap, type ScenarioRecord } from "./repository";

describe("ScenarioPlanningDialog",()=>{
 it("preserves nested purchase financing while editing and saves an ordered catch-all",async()=>{
  const data=await testRepository.bootstrap() as Bootstrap;
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+1);const eventDate=date.toISOString().slice(0,10);
  const record:ScenarioRecord={id:"plan",householdId:"test",name:"Plan",isBaseline:false,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:12,revision:4,events:[{id:"buy",date:eventDate,type:"asset-purchase",assetId:"future-home",name:"Future home",valueCents:50000000,annualGrowthBps:300,fundingAccountId:"cash",downPaymentCents:10000000,costsCents:100000,financing:{liabilityId:"future-loan",name:"Mortgage",principalCents:40000000,annualRateBps:650,minimumPaymentCents:250000}}],allocations:[{id:"rule",accountId:"cash",priority:1,percentBps:10000}],withdrawals:[],goals:[]};
  const updateScenario=vi.fn();render(<ScenarioPlanningDialog record={record} bootstrap={data} repository={{...testRepository,updateScenario}} close={vi.fn()} refresh={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:/Edit Asset purchase/}));
  expect(screen.getByLabelText("Debt name")).toHaveValue("Mortgage");
  fireEvent.click(screen.getByRole("button",{name:"Save event"}));fireEvent.click(screen.getByRole("button",{name:"Save plan"}));
  await waitFor(()=>expect(updateScenario).toHaveBeenCalledWith(expect.objectContaining({expectedRevision:4,events:[expect.objectContaining({financing:expect.objectContaining({liabilityId:"future-loan",principalCents:40000000})})],allocations:[expect.objectContaining({priority:1,percentBps:10000})]})));
 });
});
