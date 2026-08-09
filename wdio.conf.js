import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

let driver;
const scenario = process.env.LIFELOOK_E2E_SCENARIO ?? "acceptance";
const application = resolve(
  process.env.LIFELOOK_E2E_BINARY ?? "src-tauri/target/release/lifelook",
);

export const config = {
  runner: "local",
  specs: [`./e2e/specs/${scenario}.e2e.js`],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": { application },
    },
  ],
  hostname: "127.0.0.1",
  port: 4444,
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 120_000 },
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  onPrepare() {
    mkdirSync(resolve("artifacts/native-e2e"), { recursive: true });
    driver = spawn("tauri-driver", [], {
      detached: true,
      stdio: "inherit",
    });
    driver.on("exit", (code) => {
      if (code && code !== 0) process.exitCode = code;
    });
  },
  onComplete() {
    if (driver?.pid) {
      try {
        process.kill(-driver.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  },
};
