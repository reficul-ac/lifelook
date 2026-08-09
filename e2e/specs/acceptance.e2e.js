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

describe("LifeLook native acceptance", () => {
  it("persists onboarding, member edits, appearance, and exercises supported layouts", async () => {
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

    const accountName = await $('[aria-label="Account 1 name"]');
    await accountName.waitForDisplayed();
    await $("aria/Filing status").selectByAttribute("value", "single");
    await $("aria/Checking").click();
    await accountName.setValue("Everyday checking");
    await $('[aria-label="Account 1 opening balance"]').setValue("1250.00");
    await $("aria/Finish setup").click();
    await $("aria/Overview").waitForDisplayed();
    const overviewNav = await $("nav button:nth-child(1)");
    assert.equal(await overviewNav.getAttribute("aria-current"), "page");
    assert.equal(await $("aria/Search (not yet available)").isEnabled(), false);
    assert.equal(await $("aria/Add (unavailable)").isEnabled(), false);
    await browser.saveScreenshot(artifact("01-light-920x650.png"));

    const planNav = await $("nav button:nth-child(3)");
    await planNav.click();
    assert.equal(await planNav.getAttribute("aria-current"), "page");
    const year = await $(".year-row[aria-expanded]");
    assert.equal(await year.getAttribute("aria-expanded"), "false");
    await year.click();
    assert.equal(await year.getAttribute("aria-expanded"), "true");
    const monthPanelId = await year.getAttribute("aria-controls");
    const monthPanel = await $(`#${monthPanelId}`);
    assert.equal(await monthPanel.getAttribute("role"), "region");
    assert.ok((await monthPanel.getAttribute("aria-label")).includes("monthly detail"));
    await browser.saveScreenshot(artifact("02-plan-expanded-920x650.png"));

    await $("aria/Settings").click();
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
    assert.equal(await dark.isSelected(), true);
    const member = await $("aria/Member 1 name");
    await member.setValue("Persisted Member With A Deliberately Long Name");
    await $("aria/Save members").click();
    await $("aria/Household members saved.").waitForDisplayed();
    await reducedMotion.click();
    await browser.waitUntil(async () => (await reducedMotion.getAttribute("aria-checked")) === "true");
    await browser.saveScreenshot(artifact("03-dark-settings-920x650.png"));

    await browser.reloadSession();
    await $("aria/Overview").waitForDisplayed();
    await $("aria/Settings").click();
    assert.equal(await $("aria/Dark").isSelected(), true);
    assert.equal(await $('button[role="switch"]').getAttribute("aria-checked"), "true");
    assert.equal(await $("aria/Member 1 name").getValue(), "Persisted Member With A Deliberately Long Name");
    await $("aria/Net Worth").click();
    assert.equal(await $('//*[normalize-space()="Everyday checking"]').isExisting(), true);

    for (const [width, height] of [[1024, 768], [1280, 820]]) {
      await browser.setWindowSize(width, height);
      await $("aria/Plan").click();
      const row = await $(".year-row[aria-expanded]");
      if ((await row.getAttribute("aria-expanded")) === "false") await row.click();
      assert.equal(await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await browser.saveScreenshot(artifact(`layout-plan-expanded-${width}x${height}.png`));
    }

    const activityNav = await $("nav button:nth-child(2)");
    await activityNav.addValue("\uE007");
    await $("aria/Search activity").waitForDisplayed();
    const colors = await browser.execute(() => {
      const read = (selector) => {
        let node = document.querySelector(selector);
        let temporary = false;
        if (!node) {
          node = document.createElement("span");
          node.className = selector.slice(1);
          document.querySelector(".card").append(node);
          temporary = true;
        }
        const style = getComputedStyle(node);
        const sample = { color: style.color, background: getComputedStyle(node.closest(".card")).backgroundColor };
        if (temporary) node.remove();
        return sample;
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
    await browser.saveScreenshot(artifact("06-dark-activity-search-focus-1280x820.png"));
  });
});
