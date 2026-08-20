import assert from "node:assert/strict";
import { onboard, openAdd, saveDialog, setLabeledValue } from "./helpers.js";

async function metricValue(title) {
  return $(`//*[contains(concat(" ",normalize-space(@class)," ")," metric ")][.//*[normalize-space()="${title}"]]//strong`).getText();
}

describe("LifeLook native financial records", () => {
  it("creates, edits, deletes, and relaunches assets and a mortgage", async () => {
    await onboard();
    await openAdd("Asset");
    await setLabeledValue("Asset name", "Home");
    await setLabeledValue("Current value (USD)", "100000.00");
    await setLabeledValue("Annual growth (%)", "3.50");
    await saveDialog();

    await openAdd("Debt");
    await setLabeledValue("Debt name", "Mortgage");
    await setLabeledValue("Current balance (USD)", "80000.00");
    await setLabeledValue("Annual interest rate (%)", "6.50");
    await $('//label[contains(normalize-space(.),"Include mortgage details")]//input').click();
    await setLabeledValue("Original principal (USD)", "90000.00");
    await setLabeledValue("Mortgage start date", "2020-01-15");
    await setLabeledValue("Original term (months)", "360");
    assert.match(await $('[role="status"]').getText(), /principal and interest/i);
    await $('//label[contains(normalize-space(.),"Use custom monthly payment")]//input').click();
    await setLabeledValue("Custom monthly payment (USD)", "750.00");
    await saveDialog();

    await $("aria/Net Worth").click();
    assert.equal(await metricValue("Total assets"), "$101,000.00");
    assert.equal(await metricValue("Total debt"), "$80,000.00");
    assert.equal(await metricValue("Net worth"), "$21,000.00");
    const home = await $('//*[contains(@class,"account")][.//strong[normalize-space()="Home"]]');
    await home.click();
    await setLabeledValue("Current value (USD)", "110000.00");
    await saveDialog();

    await openAdd("Asset");
    await setLabeledValue("Asset name", "Temporary asset");
    await setLabeledValue("Current value (USD)", "1.00");
    await setLabeledValue("Annual growth (%)", "0");
    await saveDialog();
    await $("aria/Net Worth").click();
    const temporary = await $('//*[contains(@class,"account")][.//strong[normalize-space()="Temporary asset"]]');
    await temporary.click();
    await $("aria/Delete").click();
    await $("aria/Delete permanently").click();
    await browser.waitUntil(async () => !(await temporary.isExisting()));

    await openAdd("Debt");
    await setLabeledValue("Debt name", "Temporary debt");
    await setLabeledValue("Current balance (USD)", "1.00");
    await setLabeledValue("Annual interest rate (%)", "0");
    await setLabeledValue("Minimum monthly payment (USD)", "1.00");
    await saveDialog();
    await $("aria/Net Worth").click();
    const temporaryDebt = await $('//*[contains(@class,"account")][.//strong[normalize-space()="Temporary debt"]]');
    await temporaryDebt.click();
    await $("aria/Delete").click();
    await $("aria/Delete permanently").click();
    await browser.waitUntil(async () => !(await temporaryDebt.isExisting()));

    await browser.reloadSession();
    await $("aria/Net Worth").click();
    assert.equal(await metricValue("Total assets"), "$111,000.00");
    assert.equal(await metricValue("Total debt"), "$80,000.00");
    const mortgage = await $('//*[contains(@class,"account")][.//strong[normalize-space()="Mortgage"]]');
    await mortgage.click();
    assert.equal(await $("aria/Custom monthly payment (USD)").getValue(), "750");
  });
});
