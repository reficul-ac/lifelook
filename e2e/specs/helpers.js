import { execFileSync } from "node:child_process";

export async function setReactInput(field, value) {
  await browser.execute((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, field, value);
}

export async function setLabeledValue(label, value) {
  const field = await $(`aria/${label}`);
  if ((await field.getAttribute("type")) === "date") await setReactInput(field, value);
  else await field.setValue(value);
}

export async function saveDialog() {
  await $("aria/Save").click();
  await browser.waitUntil(async () => !(await browser.execute(() => Boolean(document.querySelector('[role="dialog"]')))));
  await browser.pause(250);
}

export async function openAdd(kind) {
  await $("aria/Add").click();
  await $(`//div[@role="menu"]//button[@role="menuitem" and normalize-space()="${kind}"]`).click();
}

export async function onboard({ secondAccount = false } = {}) {
  const household = await $("aria/Household name");
  try {
    await household.waitForDisplayed();
  } catch (error) {
    console.error(await browser.getPageSource());
    throw error;
  }
  await household.setValue("Hybrid native household");
  await $('[aria-label="Person 1 name"]').setValue("Native Person");
  await $("aria/Save & Continue").click();
  await $("aria/Filing status").selectByAttribute("value", "single");
  await $("aria/Save & Continue").click();
  await $("aria/Checking").click();
  await $('[aria-label="Account 1 name"]').setValue("Checking");
  await $('[aria-label="Account 1 opening balance"]').setValue("1000.00");
  if (secondAccount) {
    await $("aria/Add another account").click();
    await (await $$("aria/Savings")).at(-1).click();
    await $('[aria-label="Account 2 name"]').setValue("Savings");
    await $('[aria-label="Account 2 opening balance"]').setValue("0.00");
  }
  await $("aria/Save & Continue").click();
  for (let step = 0; step < 4; step += 1) await $("aria/Skip & Continue").click();
  await $("aria/Finish setup").click();
  await $("aria/Overview").waitForDisplayed();
}

export async function chooseOpenFile(path) {
  await browser.pause(500);
  const windowId = execFileSync("xdotool", ["search", "--name", "^Open File$"], { encoding: "utf8" }).trim().split("\n").at(-1);
  execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
  execFileSync("xdotool", ["key", "--window", windowId, "--clearmodifiers", "ctrl+l"]);
  execFileSync("xdotool", ["type", "--window", windowId, "--clearmodifiers", "--delay", "1", path]);
  execFileSync("xdotool", ["key", "--window", windowId, "--clearmodifiers", "Return"]);
  await browser.pause(300);
  execFileSync("xdotool", ["key", "--window", windowId, "--clearmodifiers", "alt+o"]);
}
