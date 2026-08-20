import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const artifact = (name) => resolve(process.env.LIFELOOK_E2E_ARTIFACT_DIR ?? "artifacts/native-e2e", name);
const currentYear = String(new Date().getFullYear());
const priorYear = String(new Date().getFullYear() - 1);
const currentDate = `${currentYear}-02-15`;
const priorDate = `${priorYear}-12-15`;

async function setReactInput(field, value) {
  await browser.execute((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, field, value);
}

async function setLabeledValue(label, value) {
  const field = await $(`aria/${label}`);
  if (label === "Date") {
    await setReactInput(field, value);
  } else {
    await field.setValue(value);
  }
}

async function selectLabeled(label, visibleText) {
  const field = await $(`//label[starts-with(normalize-space(.),"${label}")]//select`);
  await field.selectByVisibleText(visibleText);
}

async function saveDialog() {
  await $("aria/Save").click();
  await browser.waitUntil(async () => !(await browser.execute(() => Boolean(document.querySelector('[role="dialog"]')))));
  // The workspace refresh starts after persistence and is intentionally fire-and-forget.
  await browser.pause(250);
}

async function openAdd(kind) {
  await $("aria/Add").click();
  await $(`//div[@role="menu"]//button[@role="menuitem" and normalize-space()="${kind}"]`).click();
}

async function addTransaction(kind, { date, amount, account, description }) {
  await openAdd(kind);
  await setLabeledValue("Date", date);
  await setLabeledValue("Amount (USD)", amount);
  if (account) await selectLabeled("Account", account);
  await setLabeledValue("Description", description);
  await saveDialog();
}

async function activityTotal() {
  return $(".card-title strong").getText();
}

async function metricValue(title) {
  return $(`//*[contains(concat(" ",normalize-space(@class)," ")," metric ")][.//*[normalize-space()="${title}"]]//strong`).getText();
}

async function accountBalance(name) {
  return $(`//*[contains(@class,"account")][.//strong[normalize-space()="${name}"]]//b`).getText();
}

const entryButton = (name) => $(`[aria-label="Edit ${name}"]`);
const primaryNavButton = (name) =>
  $(`nav[aria-label="Primary navigation"] button[aria-label="${name}"]`);
const settingsSectionButton = (name) =>
  $(`//nav[@aria-label="Settings sections"]//button[normalize-space()="${name}"]`);

async function assertActivity({ total, rows, present = [], absent = [] }) {
  await browser.waitUntil(async () => (await activityTotal()) === total, { timeout: 3_000, timeoutMsg: `Activity total did not become ${total}` });
  assert.equal(await activityTotal(), total);
  assert.equal((await $$(".transaction-action")).length, rows);
  for (const name of present) assert.equal(await entryButton(name).isExisting(), true, `${name} should be visible`);
  for (const name of absent) assert.equal(await entryButton(name).isExisting(), false, `${name} should be filtered out`);
}

async function assertDerivedViews() {
  await primaryNavButton("Overview").click();
  await $(".hero h2").waitForDisplayed();
  assert.equal(await metricValue("Income"), "$2,000.00");
  assert.equal(await metricValue("Spending"), "$150.00");
  assert.equal(await metricValue("Saved"), "$1,850.00");
  assert.equal(await $(".hero h2").getText(), "$3,610.00");

  await primaryNavButton("Net Worth").click();
  assert.equal(await metricValue("Total assets"), "$3,610.00");
  assert.equal(await metricValue("Net worth"), "$3,610.00");
  assert.equal(await accountBalance("Everyday checking"), "$2,810.00");
  assert.equal(await accountBalance("Rainy day savings"), "$800.00");
}

function channel(hex, offset) {
  return Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

function luminance(hex) {
  const values = [1, 3, 5].map((offset) => {
    const value = channel(hex, offset);
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHex(rgb) {
  const values = rgb.match(/\d+/g).slice(0, 3).map(Number);
  return `#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function chooseNativeFile(path, confirmSelection = false) {
  await browser.pause(500);
  const title = confirmSelection ? "^Open File$" : "^Save File$";
  const windowId = execFileSync("xdotool", ["search", "--name", title], { encoding: "utf8" }).trim().split("\n").at(-1);
  execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
  execFileSync("xdotool", ["key", "--window", windowId, "--clearmodifiers", "ctrl+l"]);
  execFileSync("xdotool", ["type", "--window", windowId, "--clearmodifiers", "--delay", "1", path]);
  execFileSync("xdotool", ["key", "--window", windowId, "--clearmodifiers", "Return"]);
  if (confirmSelection) {
    await browser.pause(300);
    execFileSync("xdotool", ["key", "--window", windowId, "--clearmodifiers", "alt+o"]);
  }
}

describe("LifeLook native acceptance", () => {
  it("persists onboarding, ledger, accounts, member edits, appearance, and supported layouts", async () => {
    await browser.setWindowSize(920, 650);
    const household = await $("aria/Household name");
    try {
      await household.waitForDisplayed();
    } catch (error) {
      await browser.saveScreenshot(artifact("startup-failure.png"));
      console.error(await browser.getPageSource());
      throw error;
    }
    await household.setValue("Native E2E Household With A Deliberately Long Name");
    await $('[aria-label="Person 1 name"]').setValue("Native Tester With A Deliberately Long Name");
    await $("aria/Save & Continue").click();
    await $("aria/Filing status").selectByAttribute("value", "single");
    await $("aria/Save & Continue").click();
    const accountName = await $('[aria-label="Account 1 name"]');
    await accountName.waitForDisplayed();
    await $("aria/Checking").click();
    await accountName.setValue("Everyday checking");
    await $('[aria-label="Account 1 opening balance"]').setValue("1250.00");
    await $("aria/Save & Continue").click();
    for (let step = 0; step < 4; step += 1) await $("aria/Skip & Continue").click();
    await $("aria/Finish setup").click();
    await primaryNavButton("Overview").waitForDisplayed();
    const overviewNav = await primaryNavButton("Overview");
    assert.equal(await overviewNav.getAttribute("aria-current"), "page");
    assert.equal(await $("aria/Search workspace").isEnabled(), true);
    const add = await $("aria/Add");
    assert.equal(await add.isEnabled(), true);
    await add.click();
    assert.equal(await $('[role="menu"][aria-label="Add"]').isDisplayed(), true);
    for (const mode of ["Income", "Expense", "Transfer", "Account"]) {
      assert.equal(await $(`aria/${mode}`).isEnabled(), true);
    }
    await browser.keys("Escape");
    await browser.saveScreenshot(artifact("01-light-920x650.png"));

    await openAdd("Account");
    await setLabeledValue("Account name", "Temporary savings");
    await selectLabeled("Account type", "Savings");
    await setLabeledValue("Opening balance (USD)", "500.00");
    await saveDialog();

    await primaryNavButton("Net Worth").click();
    const temporaryAccount = await $('//*[contains(@class,"account")][.//strong[normalize-space()="Temporary savings"]]');
    await temporaryAccount.click();
    await setLabeledValue("Account name", "Rainy day savings");
    await saveDialog();

    await addTransaction("Income", { date: currentDate, amount: "2000.00", account: "Everyday checking", description: "Native salary" });
    await addTransaction("Expense", { date: currentDate, amount: "125.00", account: "Everyday checking", description: "Native groceries" });

    await openAdd("Transfer");
    await setLabeledValue("Date", currentDate);
    await setLabeledValue("Amount (USD)", "300.00");
    await selectLabeled("From account", "Everyday checking");
    await selectLabeled("To account", "Rainy day savings");
    await saveDialog();

    await addTransaction("Expense", { date: priorDate, amount: "40.00", account: "Everyday checking", description: "Prior year parking" });

    await primaryNavButton("Activity").click();
    await entryButton("Native groceries").click();
    await setLabeledValue("Amount (USD)", "150.00");
    await setLabeledValue("Description", "Edited groceries");
    await saveDialog();
    await entryButton("Transfer").click();
    await setLabeledValue("Amount (USD)", "250.00");
    await saveDialog();

    await primaryNavButton("Net Worth").click();
    const savingsAccount = await $('//*[contains(@class,"account")][.//strong[normalize-space()="Rainy day savings"]]');
    await savingsAccount.$("aria/More actions for Rainy day savings").click();
    await $("aria/Reconcile").click();
    await setLabeledValue("Date", currentDate);
    await setLabeledValue("Target current balance (USD)", "800.00");
    await saveDialog();

    await primaryNavButton("Activity").click();
    await assertActivity({ total: "$1,900.00", rows: 4, present: ["Native salary", "Edited groceries", "Transfer", "Balance reconciliation"], absent: ["Prior year parking"] });
    assert.equal((await $$('[aria-label="Edit Transfer"]')).length, 1, "the two transfer postings should render as one row");
    await browser.execute(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));
    const workspaceSearch = await $('input[aria-label="Search workspace"]');
    await workspaceSearch.setValue("Edited groceries");
    await browser.keys("Enter");
    await primaryNavButton("Activity").waitForDisplayed();
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.getAttribute("aria-label") === "Edit Edited groceries"));
    await browser.saveScreenshot(artifact("04-native-activity-ledger-920x650.png"));

    const searchActivity = await $("aria/Search activity");
    await searchActivity.setValue("groceries");
    await assertActivity({ total: "-$150.00", rows: 1, present: ["Edited groceries"], absent: ["Native salary", "Transfer"] });
    await setReactInput(searchActivity, "");
    await $("aria/Filters").click();
    await $("#activity-account").selectByVisibleText("Rainy day savings");
    await assertActivity({ total: "$50.00", rows: 2, present: ["Transfer", "Balance reconciliation"], absent: ["Native salary", "Edited groceries"] });
    await $("#activity-account").selectByVisibleText("All accounts");
    await $("#activity-year").selectByVisibleText(priorYear);
    await assertActivity({ total: "-$40.00", rows: 1, present: ["Prior year parking"], absent: ["Native salary", "Transfer"] });
    await $("#activity-year").selectByVisibleText("All years");
    await assertActivity({ total: "$1,860.00", rows: 5, present: ["Native salary", "Edited groceries", "Transfer", "Prior year parking", "Balance reconciliation"] });

    const exportPath = process.env.LIFELOOK_E2E_ACTIVITY_EXPORT;
    assert.ok(exportPath);
    await setReactInput(searchActivity, "Transfer");
    await $("aria/Actions").click();
    await $("aria/Export CSV").click();
    // GTK applies the active CSV filter's extension when the name is accepted.
    // Enter the basename so the resulting destination is exactly exportPath.
    await chooseNativeFile(exportPath.replace(/\.csv$/i, ""));
    await browser.waitUntil(() => {
      try { return readFileSync(exportPath, "utf8").split("\r\n").length === 4; } catch { return false; }
    }, { timeout: 5_000, timeoutMsg: "Activity export was not written" });
    const exported = readFileSync(exportPath, "utf8");
    assert.equal(exported.split("\r\n")[0], "date,type,description,note,account,category,amount,transfer group");
    assert.ok(exported.includes(",transfer,Transfer,,Everyday checking,,-250.00,"));
    assert.ok(exported.includes(",transfer,Transfer,,Rainy day savings,,250.00,"));
    await setReactInput(searchActivity, "");

    await assertDerivedViews();
    await browser.saveScreenshot(artifact("05-native-net-worth-920x650.png"));

    const planNav = await primaryNavButton("Plan");
    await planNav.click();
    assert.equal(await planNav.getAttribute("aria-current"), "page");
    const annualWealth = await $('//details[summary[normalize-space()="View annual wealth data"]]');
    assert.equal(await annualWealth.getAttribute("open"), null);
    await annualWealth.$("summary").click();
    await annualWealth.$('[aria-label="Annual wealth projection"] table').waitForDisplayed();
    assert.notEqual(await annualWealth.getAttribute("open"), null);
    await browser.saveScreenshot(artifact("02-plan-expanded-920x650.png"));

    await primaryNavButton("Settings").click();
    await settingsSectionButton("Appearance").click();
    const switches = await $$('button[role="switch"]');
    assert.equal(switches.length, 1);
    const reducedMotion = switches[0];
    assert.equal(await reducedMotion.getAttribute("aria-labelledby"), "reduced-motion-label");
    assert.equal(await reducedMotion.getAttribute("aria-describedby"), "reduced-motion-description");
    assert.equal(await reducedMotion.getAttribute("aria-checked"), "false");
    const dark = await $("aria/Dark");
    assert.equal(await dark.getAttribute("type"), "radio");
    assert.equal(await dark.isSelected(), false);
    await dark.click();
    await browser.waitUntil(async () => await dark.isSelected());
    await reducedMotion.click();
    await browser.waitUntil(async () => (await reducedMotion.getAttribute("aria-checked")) === "true");
    await settingsSectionButton("Household").click();
    const member = await $("aria/Member 1 name");
    await member.setValue("Persisted Member With A Deliberately Long Name");
    await $("aria/Save members").click();
    await $("aria/Household members saved.").waitForDisplayed();
    await browser.saveScreenshot(artifact("03-dark-settings-920x650.png"));

    await browser.reloadSession();
    await primaryNavButton("Overview").waitForDisplayed();
    await assertDerivedViews();
    await primaryNavButton("Activity").click();
    await assertActivity({ total: "$1,900.00", rows: 4, present: ["Native salary", "Edited groceries", "Transfer", "Balance reconciliation"], absent: ["Prior year parking"] });
    assert.equal((await $$('[aria-label="Edit Transfer"]')).length, 1);
    await primaryNavButton("Settings").click();
    await settingsSectionButton("Appearance").click();
    assert.equal(await $("aria/Dark").isSelected(), true);
    assert.equal(await $('button[role="switch"]').getAttribute("aria-checked"), "true");
    await settingsSectionButton("Household").click();
    assert.equal(await $("aria/Member 1 name").getValue(), "Persisted Member With A Deliberately Long Name");
    const backupPath = process.env.LIFELOOK_E2E_BACKUP;
    assert.ok(backupPath);
    await settingsSectionButton("Data & Privacy").click();
    await $("aria/Back up data").click();
    await chooseNativeFile(backupPath);
    await $("aria/Backup created successfully.").waitForDisplayed();
    await settingsSectionButton("Household").click();
    const restoredMember = await $("aria/Member 1 name");
    await restoredMember.setValue("Mutated after backup");
    await $("aria/Save members").click();
    await $("aria/Household members saved.").waitForDisplayed();
    await settingsSectionButton("Data & Privacy").click();
    await $("aria/Choose backup").click();
    await $('[role="alertdialog"]').waitForDisplayed();
    await $("aria/Choose backup and restore").click();
    await chooseNativeFile(backupPath, true);
    await browser.waitUntil(async () => (await browser.execute(() => [...document.querySelectorAll('[role="status"], [role="alert"]')].map(element => element.textContent))).some(message => message?.includes("backup") || message?.includes("Backup")), { timeout: 10_000 });
    const restoreMessages = await browser.execute(() => [...document.querySelectorAll('[role="status"], [role="alert"]')].map(element => element.textContent ?? ""));
    assert.ok(restoreMessages.some(message => message.includes("Backup restored successfully")), `Restore feedback: ${restoreMessages.join(" | ")}`);
    await settingsSectionButton("Household").click();
    assert.equal(await $("aria/Member 1 name").getValue(), "Persisted Member With A Deliberately Long Name");
    await browser.reloadSession();
    await primaryNavButton("Overview").waitForDisplayed();
    await primaryNavButton("Settings").click();
    assert.equal(await $("aria/Member 1 name").getValue(), "Persisted Member With A Deliberately Long Name");
    await primaryNavButton("Net Worth").click();
    assert.equal(await $('//*[normalize-space()="Everyday checking"]').isExisting(), true);

    for (const [width, height] of [[1024, 768], [1280, 820]]) {
      await browser.setWindowSize(width, height);
      await primaryNavButton("Plan").click();
      const disclosure = await $('//details[summary[normalize-space()="View annual wealth data"]]');
      if ((await disclosure.getAttribute("open")) === null) await disclosure.$("summary").click();
      await disclosure.$('[aria-label="Annual wealth projection"] table').waitForDisplayed();
      assert.equal(await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await browser.saveScreenshot(artifact(`layout-plan-expanded-${width}x${height}.png`));
    }

    const activityNav = await primaryNavButton("Activity");
    await activityNav.addValue("\uE007");
    await $("aria/Search activity").waitForDisplayed();
    const colors = await browser.execute(() => {
      const card = document.querySelector(".transaction-action")?.closest(".card");
      if (!(card instanceof HTMLElement)) throw new Error("Activity card is unavailable");
      const read = (className) => {
        const node = document.createElement("span");
        node.className = className;
        card.append(node);
        const style = getComputedStyle(node);
        const sample = { color: style.color, background: getComputedStyle(card).backgroundColor };
        node.remove();
        return sample;
      };
      return { positive: read("positive"), negative: read("negative") };
    });
    for (const sample of [colors.positive, colors.negative]) {
      assert.ok(contrast(rgbToHex(sample.color), rgbToHex(sample.background)) >= 4.5);
    }

    const search = await $("aria/Search activity");
    for (let index = 0; index < 24 && !(await search.isFocused()); index += 1) {
      await browser.keys("\uE004");
    }
    assert.equal(await search.isFocused(), true);
    const focusStyle = await browser.execute(() => {
      const container = document.querySelector(".search");
      return getComputedStyle(container).boxShadow;
    });
    assert.notEqual(focusStyle, "none");
    await browser.saveScreenshot(artifact("06-dark-activity-search-focus-1280x820.png"));

    await openAdd("Asset");
    await $('//label[contains(normalize-space(.),"This asset is a home")]//input').click();
    await setLabeledValue("Asset name", "Retirement home");
    await setLabeledValue("Current home value (USD)", "500000.00");
    await setLabeledValue("Original purchase price (USD)", "300000.00");
    await setLabeledValue("Purchase date", priorDate);
    await $('//label[contains(normalize-space(.),"Financed with a mortgage")]//input').click();
    await $('//summary[normalize-space()="Sale and tax details"]').click();
    await setReactInput(await $("aria/Selling costs (%)"), "");
    await saveDialog();

    await primaryNavButton("Retirement").click();
    const retirementMonth = await $("aria/Retirement month");
    await retirementMonth.waitForDisplayed();
    assert.equal(await retirementMonth.getAttribute("type"), "month");
    const withdrawalRate = await $("aria/Withdrawal rate");
    assert.equal(await withdrawalRate.getValue(), "3");
    assert.equal(await withdrawalRate.$("..").getText(), "%");
    assert.equal(await $("aria/If you keep your homes").isDisplayed(), true);
    assert.equal(await $("aria/If you sell all homes").isDisplayed(), true);
    for (const legacyControl of [
      "Retirement readiness",
      "Portfolio runway",
      "Add retirement item",
    ]) {
      assert.equal(await $(`aria/${legacyControl}`).isExisting(), false);
    }

    const sellStory = await $('//article[.//h2[normalize-space()="If you sell all homes"]]');
    const sellHeadlines = await sellStory.$$("strong");
    assert.equal(sellHeadlines.length, 2);
    assert.equal(await sellHeadlines[0].getText(), "Unavailable");
    assert.equal(await sellHeadlines[1].getText(), "Unavailable");
    await sellStory.$("aria/View calculation").click();
    assert.match(
      await sellStory.$(".retirement-unavailable").getText(),
      /Add the following home details to calculate a sale[\s\S]*Add selling costs for Retirement home\./,
    );
    await browser.saveScreenshot(artifact("07-retirement-snapshot-unavailable-1280x820.png"));
  });
});
