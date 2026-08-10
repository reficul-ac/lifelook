import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("LifeLook corrupt-profile recovery", () => {
  it("shows recovery without changing the corrupt bytes", async () => {
    const profile = process.env.LIFELOOK_E2E_PROFILE;
    assert.ok(profile);
    const alert = await $("aria/LifeLook couldn’t open your data");
    await alert.waitForDisplayed();
    assert.match(await $("[role=alert]").getText(), /integrity|database|profile/i);
    assert.equal(await $("aria/Retry").isEnabled(), true);
    const hash = createHash("sha256").update(readFileSync(profile)).digest("hex");
    assert.equal(hash, process.env.LIFELOOK_E2E_CORRUPT_SHA256);
    await browser.saveScreenshot(resolve(process.env.LIFELOOK_E2E_ARTIFACT_DIR ?? "artifacts/native-e2e", "07-corrupt-profile-recovery.png"));
  });
});
