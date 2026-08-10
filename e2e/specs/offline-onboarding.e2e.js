import assert from "node:assert/strict";
import { onboard } from "./helpers.js";

describe("LifeLook strict-offline onboarding", () => {
  it("launches and completes setup without a network service", async () => {
    assert.equal(process.env.LIFELOOK_E2E_STRICT_OFFLINE, "1");
    await onboard();
    assert.equal(await $("aria/Overview").isDisplayed(), true);
    await browser.reloadSession();
    await $("aria/Overview").waitForDisplayed();
  });
});
