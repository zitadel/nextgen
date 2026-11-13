#!/usr/bin/env node
// What the artifacts workflow (.github/workflows/artifacts.yml) tests:
// `build`, what the checked-out ref builds, unless VERSION names a published
// release: the dispatch input, or the tag of a published GitHub Release
// (`v0.6.0`; the leading `v` is dropped). Then `published`, that release
// from npm and the registry.
//
// Writes `mode` and `version` to $GITHUB_OUTPUT and a line to
// $GITHUB_STEP_SUMMARY. Imports only Node built-ins: the workflow runs it
// without an install.
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isDirectRun, runCapture } from "./dev-process.mjs";
import { SERVER_IMAGE } from "./release-manifest.mjs";
import { previousRelease } from "./smoke-upgrade.mjs";

export async function artifactsTarget(env = process.env) {
  const version = env.VERSION?.trim().replace(/^v/, "");
  if (!version) return { mode: "build", summary: "Built from this ref." };
  // Outside the repository, whose .npmrc is the workspace's.
  const cwd = mkdtempSync(join(tmpdir(), "nextgen-target-"));
  try {
    const { stdout } = await runCapture("npm", ["view", "@zitadel/server", "time", "--json"], {
      cwd,
    });
    const times = JSON.parse(stdout);
    if (!times[version]) throw new Error(`@zitadel/server@${version} is not published`);
    return {
      mode: "published",
      version,
      summary:
        `Published @zitadel/server@${version}: installed from npm on each runner, ` +
        `container ${SERVER_IMAGE}:${version}, upgraded from ${previousRelease(version, times)}.`,
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    const target = await artifactsTarget();
    const output = `mode=${target.mode}\nversion=${target.version ?? ""}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${target.summary}\n`);
    }
    process.stdout.write(`${output}${target.summary}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
