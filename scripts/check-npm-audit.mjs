import { spawnSync } from "node:child_process";

const audit = spawnSync("npm", ["audit", "--json"], { encoding: "utf8" });
if (!audit.stdout) {
  console.error(audit.stderr || "npm audit produced no report");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error(audit.stdout);
  console.error("npm audit did not produce valid JSON");
  process.exit(1);
}

const vulnerabilities = Object.values(report.vulnerabilities ?? {});
if (vulnerabilities.length || audit.status !== 0) {
  console.error("npm dependency advisories are not permitted:");
  for (const item of vulnerabilities) console.error(`- ${item.name} (${item.severity})`);
  process.exit(1);
}
console.log("Production and full npm dependency trees have no known vulnerabilities.");
