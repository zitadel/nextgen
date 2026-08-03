#!/usr/bin/env node
import { appendFile } from "node:fs/promises";

import { isDirectRun } from "./dev-process.mjs";

// Every shard job the `full-pr` aggregator depends on, and when its result
// counts as passing. "always" shards run in every CI mode (their steps skip
// internally on version-only PRs, so the job still succeeds). "full-mode-only"
// shards are gated at the job level on the snapshot shard's detected mode, so
// on anything but a full run the expected result is "skipped" — a shard that
// ran anyway means the gate broke, and that fails the aggregate too.
//
// This map and the `needs:` list of the `full-pr` job in
// .github/workflows/ci.yml must stay in sync; drift in either direction is a
// failure, never a silent pass.
const EXPECTATIONS = {
  graph: "always",
  snapshot: "always",
  "browser-e2e": "always",
  "journey-fresh-app": "full-mode-only",
  "journey-presets": "full-mode-only",
};

/**
 * Judge the aggregate result from the `needs` context of the `full-pr` job.
 * Returns a list of problems; an empty list is a pass.
 */
export function verifyShardResults(needs) {
  const problems = [];
  const mode = needs?.snapshot?.outputs?.mode;

  for (const [job, expectation] of Object.entries(EXPECTATIONS)) {
    const result = needs?.[job]?.result;
    if (result === undefined) {
      problems.push(
        `${job}: missing from the aggregator's needs — ci.yml and verify-shard-results.mjs drifted`,
      );
      continue;
    }
    const expectSkip = expectation === "full-mode-only" && mode !== "full";
    const expected = expectSkip ? "skipped" : "success";
    if (result !== expected) {
      const context = expectSkip ? ` in mode "${mode ?? "unknown"}"` : "";
      problems.push(`${job}: result "${result}", expected "${expected}"${context}`);
    }
  }

  for (const job of Object.keys(needs ?? {})) {
    if (!(job in EXPECTATIONS)) {
      problems.push(`${job}: not covered by verify-shard-results.mjs — add an expectation`);
    }
  }

  return problems;
}

async function main() {
  const raw = process.env.SHARD_RESULTS;
  if (!raw) {
    console.error("SHARD_RESULTS is not set; the workflow must pass toJSON(needs).");
    process.exit(1);
  }

  const problems = verifyShardResults(JSON.parse(raw));
  if (problems.length === 0) {
    console.log("All shards reported the expected result.");
    return;
  }

  for (const problem of problems) {
    console.error(problem);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ["## full-pr shard results", "", ...problems.map((p) => `- ${p}`), ""];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
  process.exit(1);
}

if (isDirectRun(import.meta.url)) {
  await main();
}
