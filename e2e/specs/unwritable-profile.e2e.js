import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

describe("LifeLook unwritable-profile recovery", () => {
  it("reopens the same profile after permissions are repaired and Retry is activated", async () => {
    const profile = process.env.LIFELOOK_E2E_PROFILE;
    assert.ok(profile);
    await $("aria/LifeLook couldn’t open your data").waitForDisplayed();
    assert.match(await $("[role=alert]").getText(), /permission|write/i);
    assert.equal(existsSync(profile), false);
    chmodSync(dirname(profile), 0o755);
    await $("aria/Retry").click();
    await $("aria/Tell us about your household").waitForDisplayed();
    assert.equal(existsSync(profile), true);
    await browser.saveScreenshot(resolve("artifacts/native-e2e/08-unwritable-profile-repaired.png"));
  });
});
