import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { onboard } from "./helpers.js";

const interfaceKeys = new Set(execFileSync("gsettings", ["list-keys", "org.gnome.desktop.interface"], { encoding: "utf8" }).trim().split(/\s+/));
const setScheme = value => {
  if (interfaceKeys.has("color-scheme"))
    execFileSync("gsettings", ["set", "org.gnome.desktop.interface", "color-scheme", value]);
  // WebKitGTK 4.1 derives prefers-color-scheme from GTK's effective theme on
  // distributions that do not expose the newer key directly to WebKit.
  execFileSync("gsettings", ["set", "org.gnome.desktop.interface", "gtk-theme", value === "prefer-dark" ? "Adwaita-dark" : "Adwaita"]);
};

describe("LifeLook live system theme", () => {
  it("follows both GNOME color-scheme changes while running", async () => {
    setScheme("default");
    await onboard();
    await $('[aria-label="Settings"]').click();
    await $("aria/Appearance").click();
    await $("aria/System").click();
    await browser.waitUntil(async () => !(await $(".app").getAttribute("class")).includes("dark"));
    setScheme("prefer-dark");
    await browser.waitUntil(async () => (await $(".app").getAttribute("class")).includes("dark"));
    setScheme("default");
    await browser.waitUntil(async () => !(await $(".app").getAttribute("class")).includes("dark"));
    assert.equal(await $("aria/System").isSelected(), true);
  });
});
