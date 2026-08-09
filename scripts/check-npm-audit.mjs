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

const allowedPackages = new Set([
  "@wdio/mocha-framework",
  "mocha",
  "serialize-javascript",
]);
const allowedAdvisories = new Set([
  "https://github.com/advisories/GHSA-5c6j-r48x-rmvq",
  "https://github.com/advisories/GHSA-qj8w-gfj5-8c6v",
]);
const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const unexpected = vulnerabilities.filter((item) => {
  if (!allowedPackages.has(item.name)) return true;
  return item.via.some(
    (via) => typeof via === "object" && !allowedAdvisories.has(via.url),
  );
});

if (unexpected.length) {
  console.error("Unapproved npm advisories:");
  for (const item of unexpected) console.error(`- ${item.name} (${item.severity})`);
  process.exit(1);
}

console.log(
  vulnerabilities.length
    ? `Approved development-only WebDriver advisory chain present (${vulnerabilities.length} packages); see SECURITY.md.`
    : "Full npm dependency tree has no known vulnerabilities.",
);
