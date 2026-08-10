import assert from "node:assert/strict";
import { onboard, setLabeledValue, setReactInput } from "./helpers.js";

async function firstYearIncome(){
  return $('(//*[contains(concat(" ",normalize-space(@class)," ")," year-row ") and not(contains(@class,"table-head"))]//span[2])[1]').getText();
}

describe("LifeLook native scenario planning",()=>{
 it("isolates cloned events and persists allocations and changed projections through relaunch",async()=>{
  await onboard();await $("aria/Plan").click();
  assert.match(await firstYearIncome(),/^\$0$/);
  await $("aria/New scenario").click();
  await setReactInput(await $('//section[@role="dialog"]//label[starts-with(normalize-space(.),"Name")]/input'),"Opportunity");
  assert.equal(await $('//label[contains(normalize-space(.),"Clone active scenario settings")]//input').isSelected(),true);
  await $("aria/Create scenario").click();
  await $("aria/Active scenario").waitForExist();
  assert.equal(await $('aria/Active scenario').$('option:checked').getText(),"Opportunity");

  await $("aria/Events & allocations").click();
  await $("aria/Add event").click();
  const eventType=await $('//label[starts-with(normalize-space(.),"Event type")]/select');
  await eventType.waitForExist();
  await eventType.selectByAttribute("value","one-time-income");
  const eventDate=new Date();eventDate.setUTCDate(Math.max(1,eventDate.getUTCDate()));
  await setLabeledValue("Event date",eventDate.toISOString().slice(0,10));
  await setReactInput(await $('//label[starts-with(normalize-space(.),"Amount (USD)")]/input'),"12000.00");
  await $("aria/Save event").click();
  await $("aria/Add rule").click();
  assert.equal(await $("aria/Allocation 1 percent").getValue(),"100");
  assert.equal(await $("aria/Allocation 1 percent").isEnabled(),false);
  await $("aria/Save plan").click();
  await browser.waitUntil(async()=>!(await $('//section[@role="dialog" and .//*[contains(normalize-space(),"Plan goals")]]').isExisting()),{timeout:5_000,timeoutMsg:`Planning dialog did not close: ${(await $$('[role="alert"]')).length ? await (await $$('[role="alert"]'))[0].getText() : "no error shown"}`});
  await browser.waitUntil(async()=>/\$12K|\$12,000/.test(await firstYearIncome()),{timeout:10_000,timeoutMsg:`Projected first-year income did not change (last value: ${await firstYearIncome()})`});

  await $("aria/Active scenario").selectByVisibleText("Baseline");
  assert.match(await firstYearIncome(),/^\$0$/);
  await $("aria/Active scenario").selectByVisibleText("Opportunity");
  assert.match(await firstYearIncome(),/\$12K|\$12,000/);
  await browser.saveScreenshot("artifacts/native-e2e/scenario-planning-mutation.png");

  await browser.reloadSession();await $("aria/Plan").click();
  await $("aria/Active scenario").selectByVisibleText("Opportunity");
  assert.match(await firstYearIncome(),/\$12K|\$12,000/);
  await $("aria/Events & allocations").click();
  assert.equal(await $('//*[normalize-space()="One-time income"]').isExisting(),true);
  assert.equal(await $("aria/Allocation 1 percent").getValue(),"100");
  await $("aria/Cancel").click();
 });
});
