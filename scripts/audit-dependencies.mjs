import { spawnSync } from "node:child_process";

const advisoryUrl = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const expectedPath = ".>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces";

function run(args) {
  const result = spawnSync("pnpm", ["audit", ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseAudit(label, result) {
  try { return JSON.parse(result.stdout); }
  catch {
    process.stderr.write(`${label} pnpm audit did not return valid JSON.\n`);
    process.stderr.write(result.stderr);
    process.exitCode = 1;
    return null;
  }
}

const production = run(["--prod", "--audit-level", "high", "--json"]);
const productionReport = parseAudit("Production", production);
if (!productionReport || production.status !== 0) {
  process.stderr.write(production.stdout);
  process.stderr.write(production.stderr);
  process.exitCode = 1;
} else {
  process.stdout.write("Production dependency audit passed with no high or critical findings.\n");
}

if (productionReport) {
  const full = run(["--json"]);
  const fullReport = parseAudit("Full", full);
  if (fullReport) {
    const advisories = Object.values(fullReport.advisories ?? {});
    const expected = advisories.length === 1
      && advisories.every((item) => item.github_advisory_id === "GHSA-vfj7-8cjw-p6xm"
        && item.url === advisoryUrl
        && item.module_name === "braces"
        && item.severity === "high"
        && item.patched_versions == null
        && item.findings?.length > 0
        && item.findings.every((finding) => finding.dev === true
          && finding.paths?.length > 0
          && finding.paths.every((path) => path === expectedPath)));

    if (full.status === 0 && advisories.length === 0) {
      process.stdout.write("Full dependency audit passed with no findings.\n");
    } else if (expected) {
      process.stdout.write(
        `Full audit reports only the documented dev-tooling advisory ${advisoryUrl}; `
        + "the production dependency audit is clean. See SECURITY.md for the non-exploitability assessment.\n",
      );
    } else {
      process.stderr.write(full.stdout);
      process.stderr.write(full.stderr);
      process.stderr.write("Dependency audit contains an unreviewed or higher-severity finding.\n");
      process.exitCode = 1;
    }
  }
}
