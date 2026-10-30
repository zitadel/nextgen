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
const selectSuite = workflow.jobs.suite.steps.find((step) => step.id === "suite").run;

test.each([
  ["docs", "", "e2e-deployment", "@zitadel/docs", "apps/docs/test-results"],
  [
    "console",
    "e2e/console/playwright.deployment.config.mts",
    "console-deployment",
    "@zitadel/e2e",
    "e2e/console/test-results",
  ],
  [
    "console",
    "apps/console-e2e/playwright.deployment.config.mts",
    "e2e-deployment",
    "@zitadel/console-e2e",
    "apps/console-e2e/test-results",
  ],
  [
    "schemas",
    "e2e/schemas/playwright.deployment.config.mts",
    "schemas-deployment",
    "@zitadel/e2e",
    "",
  ],
  ["schemas", "", undefined, undefined, undefined],
  ["cli", "", "cli-deployment", "@zitadel/e2e", "e2e/cli/test-results"],
])("selects %s for a deployment with %s", async (suite, file, task, pkg, results) => {
  const result = await select(suite, file);
  assert.equal(result.task, task);
  assert.equal(result.package, pkg);
  assert.equal(result.results, results);
  assert.equal(result.present, task ? "true" : undefined);
});

test.each(["console", "unknown"])("refuses %s when there is no runnable suite", async (suite) => {
  await assert.rejects(select(suite, ""));
});

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
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: join(cwd, "summary"),
      },
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
