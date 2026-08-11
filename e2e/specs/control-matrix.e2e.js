import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { onboard } from "./helpers.js";

const appearances = [
  { id: "light", setting: "Light", dark: false },
  { id: "dark", setting: "Dark", dark: true },
  { id: "system-light", setting: "System", system: "default", dark: false },
  { id: "system-dark", setting: "System", system: "prefer-dark", dark: true },
];
const viewports = [[920, 650], [1024, 768], [1280, 820], [1600, 1000]];
const artifactDir = resolve(process.env.LIFELOOK_E2E_ARTIFACT_DIR ?? "artifacts/control-matrix");
const packageSha256 = process.env.LIFELOOK_E2E_PACKAGE_SHA256 ?? "unrecorded";

function setSystemScheme(value) {
  execFileSync("gsettings", ["set", "org.gnome.desktop.interface", "color-scheme", value]);
  execFileSync("gsettings", ["set", "org.gnome.desktop.interface", "gtk-theme", value === "prefer-dark" ? "Adwaita-dark" : "Adwaita"]);
}

async function keyboardActivate(element) {
  await element.scrollIntoView();
  await element.addValue("\uE007");
}

describe("LifeLook exact-package control matrix", () => {
  it("operates persistent shell controls in all 32 appearance/layout states", async () => {
    mkdirSync(artifactDir, { recursive: true });
    await onboard({ secondAccount: true });
    const results = [];

    for (const appearance of appearances) for (const reducedMotion of [false, true]) for (const [width, height] of viewports) {
      const id = `${appearance.id}-motion-${reducedMotion ? "reduced" : "full"}-${width}x${height}`;
      const startedAt = new Date().toISOString();
      await browser.setWindowSize(width, height);
      if (appearance.system) setSystemScheme(appearance.system);

      await $("aria/Settings").click();
      const theme = await $(`aria/${appearance.setting}`);
      await theme.click();
      await browser.waitUntil(async () => (await theme.isSelected()) === true);
      const motion = await $('button[role="switch"]');
      if ((await motion.getAttribute("aria-checked")) !== String(reducedMotion)) await motion.click();
      await browser.waitUntil(async () => (await motion.getAttribute("aria-checked")) === String(reducedMotion));

      for (const destination of ["Overview", "Activity", "Plan", "Net Worth", "Settings"]) {
        let nav = await $(`//nav[@aria-label="Primary navigation"]//button[normalize-space()="${destination}"]`);
        await nav.click();
        nav = await $(`//nav[@aria-label="Primary navigation"]//button[normalize-space()="${destination}"]`);
        assert.equal(await nav.getAttribute("aria-current"), "page");
        await keyboardActivate(nav);
        nav = await $(`//nav[@aria-label="Primary navigation"]//button[normalize-space()="${destination}"]`);
        assert.equal(await nav.getAttribute("aria-current"), "page");
      }

      const profile = await $("button.profile");
      await profile.click();
      assert.equal(await profile.getAttribute("aria-expanded"), "true");
      await browser.keys("Escape");
      assert.equal(await profile.getAttribute("aria-expanded"), "false");

      const add = await $("aria/Add");
      await add.click();
      await $("aria/What would you like to add?").waitForDisplayed();
      await browser.keys("Escape");
      assert.equal(await $('[role="dialog"]').isExisting(), false);
      await keyboardActivate(add);
      await $("aria/What would you like to add?").waitForDisplayed();
      await browser.keys("Escape");

      await browser.keys(["Control", "k"]);
      const search = await $('input[aria-label="Search workspace"]');
      await search.waitForDisplayed();
      assert.equal(await search.isFocused(), true);
      await browser.keys("Escape");

      const observed = await browser.execute(() => ({
        dark: document.querySelector(".app")?.classList.contains("dark") ?? false,
        reducedMotion: document.querySelector(".app")?.getAttribute("data-reduced-motion") === "true",
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        viewport: [window.innerWidth, window.innerHeight],
      }));
      assert.equal(observed.dark, appearance.dark);
      assert.equal(observed.reducedMotion, reducedMotion);
      assert.equal(observed.noHorizontalOverflow, true);
      const screenshot = `${id}.png`;
      await browser.saveScreenshot(resolve(artifactDir, screenshot));
      results.push({
        id, packageSha256, profile: "populated-isolated", appearance: appearance.id,
        reducedMotion, viewport: `${width}x${height}`, inputMethods: ["pointer", "keyboard"],
        expected: "All persistent shell controls activate; focus returns; theme and motion resolve; no horizontal clipping.",
        observed, status: "Passed", startedAt, completedAt: new Date().toISOString(), screenshot,
      });
    }

    writeFileSync(resolve(artifactDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    assert.equal(results.length, 32);
  });
});
