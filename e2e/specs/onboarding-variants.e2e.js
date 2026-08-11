import assert from "node:assert/strict";
import { setReactInput } from "./helpers.js";

describe("LifeLook onboarding variants", () => {
  it("supports back, add/remove, typed accounts, calendar dates, and interruption", async () => {
    await $("aria/Household name").setValue("Resumable household");
    await $('[aria-label="Person 1 name"]').setValue("Calendar Person");

    const calendar = await $("aria/Choose Person 1 birth date from calendar");
    assert.equal(await calendar.getAttribute("type"), "date");
    await calendar.click();
    // Drive the browser's calendar input itself, rather than the visible text field.
    await setReactInput(calendar, "1988-04-23");
    assert.equal(await $("aria/Person 1 birth date").getValue(), "04/23/1988");

    await $("aria/Add another person").click();
    await $('[aria-label="Person 2 name"]').setValue("Removed Person");
    await $('//button[normalize-space()="Remove person 2"]').click();
    assert.equal(await $('[aria-label="Person 2 name"]').isExisting(), false);
    await $("aria/Save & Continue").click();

    await $("aria/Filing status").selectByAttribute("value", "single");
    await $("aria/Save & Continue").click();
    await $("aria/Credit card").click();
    await $('[aria-label="Account 1 name"]').setValue("Card");
    await $('[aria-label="Account 1 opening balance"]').setValue("125.40");
    await $("aria/Add another account").click();
    await (await $$("aria/Investment")).at(-1).click();
    await $('[aria-label="Account 2 name"]').setValue("Brokerage");
    await $('[aria-label="Account 2 opening balance"]').setValue("2500.00");
    await $("aria/Add another account").click();
    await (await $$("aria/Retirement")).at(-1).click();
    await $('[aria-label="Account 3 name"]').setValue("IRA");
    await $('[aria-label="Account 3 opening balance"]').setValue("9000.00");
    await $("aria/Add another account").click();
    await (await $$("aria/Savings")).at(-1).click();
    await $('[aria-label="Account 4 name"]').setValue("Removed account");
    await $('[aria-label="Account 4 opening balance"]').setValue("1.00");
    await $('//button[normalize-space()="Remove account 4"]').click();

    await $("aria/Back").click();
    assert.equal(await $("aria/Filing status").getValue(), "single");
    await $("aria/Back").click();
    assert.equal(await $("aria/Household name").getValue(), "Resumable household");
    assert.equal(await $("aria/Person 1 birth date").getValue(), "04/23/1988");
    await $("aria/Save & Continue").click();
    await $("aria/Save & Continue").click();

    // Relaunch midway through onboarding; committed step-one data must be restored.
    await browser.reloadSession();
    await $("aria/Credit card").waitForDisplayed();
    assert.equal(await $('[aria-label="Account 1 name"]').getValue(), "");
    await $("aria/Back").click();
    await $("aria/Back").click();
    assert.equal(await $("aria/Household name").getValue(), "Resumable household");
    assert.equal(await $("aria/Person 1 birth date").getValue(), "04/23/1988");
    await $("aria/Save & Continue").click();
    await $("aria/Filing status").selectByAttribute("value", "single");
    await $("aria/Save & Continue").click();
    await $("aria/Credit card").click();
    await $('[aria-label="Account 1 name"]').setValue("Card");
    await $('[aria-label="Account 1 opening balance"]').setValue("125.40");
    await $("aria/Add another account").click();
    await (await $$("aria/Investment")).at(-1).click();
    await $('[aria-label="Account 2 name"]').setValue("Brokerage");
    await $('[aria-label="Account 2 opening balance"]').setValue("2500.00");
    await $("aria/Add another account").click();
    await (await $$("aria/Retirement")).at(-1).click();
    await $('[aria-label="Account 3 name"]').setValue("IRA");
    await $('[aria-label="Account 3 opening balance"]').setValue("9000.00");
    await $("aria/Save & Continue").click();
    for (let step = 0; step < 4; step += 1) await $("aria/Skip & Continue").click();
    await $("aria/Finish setup").click();

    await $("aria/Overview").click();
    const noHistory = await $("//*[contains(normalize-space(), 'Historical net-worth trend unavailable')]");
    assert.equal(await noHistory.isDisplayed(), true);

    await $("aria/Net Worth").click();
    assert.equal(await $("//*[normalize-space()='Card']").isExisting(), true);
    assert.equal(await $("//*[normalize-space()='Brokerage']").isExisting(), true);
    assert.equal(await $("//*[normalize-space()='IRA']").isExisting(), true);
    await $("aria/Settings").click();
    assert.equal(await $("aria/Member 1 birth date").getValue(), "04/23/1988");
    await browser.reloadSession();
    await $("aria/Settings").click();
    assert.equal(await $("aria/Member 1 birth date").getValue(), "04/23/1988");
  });
});
