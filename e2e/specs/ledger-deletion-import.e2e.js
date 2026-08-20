import assert from "node:assert/strict";
import { chooseOpenFile, onboard, openAdd, saveDialog, setLabeledValue } from "./helpers.js";

const currentDate = `${new Date().getFullYear()}-02-15`;
const entryButton = (name) => $(`[aria-label="Edit ${name}"]`);

describe("LifeLook native deletion and import", () => {
  it("deletes ledger records and imports a mixed CSV through relaunch", async () => {
    await onboard({ secondAccount: true });
    await openAdd("Expense");
    await setLabeledValue("Date", currentDate);
    await setLabeledValue("Amount (USD)", "25.00");
    await setLabeledValue("Description", "Delete me");
    await saveDialog();
    await openAdd("Transfer");
    await setLabeledValue("Date", currentDate);
    await setLabeledValue("Amount (USD)", "100.00");
    await saveDialog();
    await $("aria/Activity").click();
    await entryButton("Delete me").click();
    await $("aria/Delete").click();
    await $("aria/Delete permanently").click();
    await entryButton("Transfer").click();
    await $("aria/Delete").click();
    await $("aria/Delete permanently").click();
    assert.equal(await entryButton("Delete me").isExisting(), false);
    assert.equal(await entryButton("Transfer").isExisting(), false);

    await $("aria/Net Worth").click();
    const savings = await $('//*[contains(@class,"account")][.//strong[normalize-space()="Savings"]]');
    await savings.click();
    await $("aria/Delete").click();
    await $("aria/Delete permanently").click();
    const checking = await $('//*[contains(@class,"account")][.//strong[normalize-space()="Checking"]]');
    await checking.click();
    await $("aria/Delete").click();
    assert.match(await $('[role="alertdialog"]').getText(), /opening balance/i);
    await $("aria/Cancel").click();
    await $("aria/Cancel").click();

    await $("aria/Activity").click();
    await $("aria/Actions").click();
    await $("aria/Import CSV").click();
    await $("aria/Choose CSV…").click();
    await chooseOpenFile(process.env.LIFELOOK_E2E_CSV);
    await $("aria/Preview").click();
    assert.match(await $(".import-preview").getText(), /Invalid calendar date/);
    assert.match(await $(".import-preview").getText(), /Duplicate \(file\)/);
    await $("aria/Include row 4").click();
    await $("aria/Import selected").click();
    await entryButton("Imported pay").waitForDisplayed();
    assert.equal((await $$('[aria-label="Edit Imported pay"]')).length, 2);

    await browser.reloadSession();
    await $("aria/Activity").click();
    assert.equal((await $$('[aria-label="Edit Imported pay"]')).length, 2);
    await $$('[aria-label="Edit Imported pay"]')[0].click();
    assert.match(await $('[role="dialog"] .muted').getText(), /read-only/i);
    await $("aria/Delete").click();
    await $("aria/Delete permanently").click();
    assert.equal((await $$('[aria-label="Edit Imported pay"]')).length, 1);
  });
});
