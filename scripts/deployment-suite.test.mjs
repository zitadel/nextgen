import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { test } from "vitest";

import { runCapture } from "./dev-process.mjs";

const workflow = parse(
  await readFile(new URL("../.github/workflows/deployment-suite.yml", import.meta.url), "utf8"),
);
const steps = workflow.jobs.suite.steps;
// Run the workflow's shell steps through suite selection in their real order.
const selectSuite = steps
  .slice(0, steps.findIndex((step) => step.id === "suite") + 1)
  .filter((step) => step.run)
  .map((step) => step.run)
  .join("\n");

test.each([
  ["docs", "", "e2e-deployment", "@zitadel/docs", "apps/docs/test-results", "true"],
  [
    "console",
    "e2e/console/playwright.deployment.config.mts",
    "console-deployment",
    "@zitadel/e2e",
    "e2e/console/test-results",
    "true",
  ],
  [
    "console",
    "apps/console-e2e/playwright.deployment.config.mts",
    "e2e-deployment",
    "@zitadel/console-e2e",
    "apps/console-e2e/test-results",
    "true",
  ],
  [
    "schemas",
    "e2e/schemas/playwright.deployment.config.mts",
    "schemas-deployment",
    "@zitadel/e2e",
    "",
    "false",
  ],
  ["schemas", "", undefined, undefined, undefined, undefined],
  ["cli", "", "cli-deployment", "@zitadel/e2e", "e2e/cli/test-results", "true"],
])("selects %s for a deployment with %s", async (suite, file, task, pkg, results, browser) => {
  const result = await select(suite, file);
  assert.equal(result.task, task);
  assert.equal(result.package, pkg);
  assert.equal(result.results, results);
  assert.equal(result.browser, browser);
  assert.equal(result.present, task ? "true" : undefined);
});

test.each(["console", "unknown"])(
  "keeps deployment diagnostics when refusing %s",
  async (suite) => {
    await assert.rejects(select(suite, ""), (error) => {
      assert.match(error.summary, /https:\/\/cloud.example.test \(dispatch, commit abcdef01\)/);
      assert.ok(error.summary.includes(`- Suite: ${suite}`));
      return true;
    });
  },
);

async function select(suite, file) {
  const cwd = await mkdtemp(join(tmpdir(), "deployment-suite-test-"));
  try {
    if (file) {
      await mkdir(dirname(join(cwd, file)), { recursive: true });
      await writeFile(join(cwd, file), "");
    }
    const output = join(cwd, "output");
    await writeFile(output, "");
    await runCapture("bash", ["-e", "-o", "pipefail", "-c", selectSuite], {
      cwd,
      env: {
        ...process.env,
        SUITE: suite,
        CLOUD_URL: "https://cloud.example.test",
        ENVIRONMENT: "dispatch",
        COMMIT: "abcdef0123456789",
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: join(cwd, "summary"),
      },
    }).catch(async (error) => {
      error.summary = await readFile(join(cwd, "summary"), "utf8");
      throw error;
    });
    return Object.fromEntries(
      (await readFile(output, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=")),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
