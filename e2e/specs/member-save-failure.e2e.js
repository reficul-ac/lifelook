import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { onboard } from "./helpers.js";

function sqlite(profile, statement) {
  execFileSync("python3", ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.close()", profile, statement]);
}

describe("LifeLook member-save SQLite failure", () => {
  it("announces and focuses the failure, retains the draft, retries, and persists", async () => {
    const profile = process.env.LIFELOOK_E2E_PROFILE;
    assert.ok(profile);
    await onboard();
    await $("aria/Settings").click();
    const member = await $("aria/Member 1 name");
    await member.setValue("Draft survives SQLite failure");

    sqlite(profile, `CREATE TRIGGER fail_member_save BEFORE UPDATE ON people BEGIN SELECT RAISE(ABORT, 'injected member write failure'); END;`);
    await $("aria/Save members").click();
    const alert = await $("[role=alert]");
    await alert.waitForDisplayed();
    assert.match(await alert.getText(), /injected member write failure|database|save/i);
    await browser.waitUntil(
      async () => alert.isFocused(),
      { timeout: 3_000, timeoutMsg: "member-save error did not receive focus" },
    );
    assert.equal(await member.getValue(), "Draft survives SQLite failure");
    assert.equal(await member.isEnabled(), true);
    assert.equal(await $("aria/Save members").isEnabled(), true);

    sqlite(profile, "DROP TRIGGER fail_member_save;");
    await $("aria/Save members").click();
    await $("aria/Household members saved.").waitForDisplayed();
    await browser.reloadSession();
    await $("aria/Settings").click();
    assert.equal(await $("aria/Member 1 name").getValue(), "Draft survives SQLite failure");
  });
});
