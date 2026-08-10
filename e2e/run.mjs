import { after, afterEach, before, describe, it } from "node:test";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { remote } from "webdriverio";

const scenario = process.env.LIFELOOK_E2E_SCENARIO ?? "acceptance";
const application = resolve(process.env.LIFELOOK_E2E_BINARY ?? "src-tauri/target/release/lifelook");
const artifactDir = resolve(process.env.LIFELOOK_E2E_ARTIFACT_DIR ?? "artifacts/native-e2e");
let driver;
let client;

Object.assign(globalThis, { describe, it, before, after, afterEach });

before(async () => {
  mkdirSync(artifactDir, { recursive: true });
  driver = spawn("tauri-driver", [], { stdio: "inherit" });
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(resolveReady, 750);
    driver.once("error", reject);
    driver.once("exit", code => { clearTimeout(timeout); reject(new Error(`tauri-driver exited with ${code}`)); });
  });
  client = await remote({hostname:"127.0.0.1",port:4444,logLevel:"warn",connectionRetryTimeout:120_000,connectionRetryCount:2,capabilities:{"tauri:options":{application}}});
  globalThis.browser = client;
  globalThis.$ = selector => client.$(selector);
  globalThis.$$ = selector => client.$$(selector);
});

afterEach(async context => {
  if (context.error && client) {
    const safe = context.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    await client.saveScreenshot(resolve(artifactDir, `failure-${scenario}-${safe}.png`)).catch(() => {});
  }
});

after(async () => {
  await client?.deleteSession().catch(() => {});
  driver?.kill("SIGTERM");
});

await import(`./specs/${scenario}.e2e.js`);
