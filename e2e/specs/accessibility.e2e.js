import assert from "node:assert/strict";
import { resolve } from "node:path";

const artifact = (name) => resolve("artifacts/native-e2e", name);

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

describe("LifeLook native accessibility", () => {
  it("completes onboarding and verifies controls, contrast, focus, and minimum viewport", async () => {
    await browser.setWindowSize(920, 650);
    const household = await $('input[value=""]');
    await household.waitForDisplayed();
    await household.setValue("Native E2E Household");
    await $('[aria-label="Person 1 name"]').setValue("Native Tester");
    await $("aria/Save & Continue").click();

    const accountName = await $('[aria-label="Account 1 name"]');
    await accountName.waitForDisplayed();
    await $("aria/Checking").click();
    await accountName.setValue("Everyday checking");
    await $('[aria-label="Account 1 opening balance"]').setValue("1250.00");
    await $("aria/Finish setup").click();
    await $("aria/Overview").waitForDisplayed();
    await browser.saveScreenshot(artifact("01-light-920x650.png"));

    await $("aria/Settings").click();
    const switches = await $$('button[role="switch"]');
    assert.equal(switches.length, 2);
    const dark = switches[0];
    const reducedMotion = switches[1];
    assert.equal(await dark.getAttribute("aria-labelledby"), "dark-theme-label");
    assert.equal(await dark.getAttribute("aria-describedby"), "dark-theme-description");
    assert.equal(await dark.getAttribute("aria-checked"), "false");
    assert.equal(await reducedMotion.getAttribute("aria-labelledby"), "reduced-motion-label");
    assert.equal(await reducedMotion.getAttribute("aria-describedby"), "reduced-motion-description");
    assert.equal(await reducedMotion.getAttribute("aria-checked"), "false");
    await dark.click();
    assert.equal(await dark.getAttribute("aria-checked"), "true");
    await browser.saveScreenshot(artifact("02-dark-settings-920x650.png"));

    const activityNav = await $("nav button:nth-child(2)");
    await activityNav.addValue("\uE007");
    await $("aria/Search activity").waitForDisplayed();
    const colors = await browser.execute(() => {
      const read = (selector) => {
        const node = document.querySelector(selector);
        const style = getComputedStyle(node);
        return { color: style.color, background: getComputedStyle(node.closest(".card")).backgroundColor };
      };
      return { positive: read(".positive"), negative: read(".negative") };
    });
    for (const sample of [colors.positive, colors.negative]) {
      assert.ok(contrast(rgbToHex(sample.color), rgbToHex(sample.background)) >= 4.5);
    }

    const search = await $("aria/Search activity");
    for (let index = 0; index < 12 && !(await search.isFocused()); index += 1) {
      await browser.keys("Tab");
    }
    assert.equal(await search.isFocused(), true);
    const focusStyle = await browser.execute(() => {
      const container = document.querySelector(".search");
      return getComputedStyle(container).boxShadow;
    });
    assert.notEqual(focusStyle, "none");
    await browser.saveScreenshot(artifact("03-dark-activity-search-focus-920x650.png"));
  });
});
