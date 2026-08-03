import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyShardResults } from "./verify-shard-results.mjs";

function needsFixture({ mode = "full", ...overrides } = {}) {
  const journeyResult = mode === "full" ? "success" : "skipped";
  return {
    graph: { result: "success", outputs: {} },
    snapshot: { result: "success", outputs: { mode } },
    "browser-e2e": { result: "success", outputs: {} },
    "journey-fresh-app": { result: journeyResult, outputs: {} },
    "journey-presets": { result: journeyResult, outputs: {} },
    ...overrides,
  };
}

test("full mode with every shard green passes", () => {
  assert.deepEqual(verifyShardResults(needsFixture()), []);
});

test("version-only mode expects the journey shards to be skipped", () => {
  assert.deepEqual(verifyShardResults(needsFixture({ mode: "version-only" })), []);
});

test("a failed shard fails the aggregate", () => {
  const problems = verifyShardResults(
    needsFixture({ "browser-e2e": { result: "failure", outputs: {} } }),
  );
  assert.deepEqual(problems, ['browser-e2e: result "failure", expected "success"']);
});

test("a cancelled shard fails the aggregate", () => {
  const problems = verifyShardResults(needsFixture({ graph: { result: "cancelled", outputs: {} } }));
  assert.deepEqual(problems, ['graph: result "cancelled", expected "success"']);
});

test("a journey shard skipped on a full run fails the aggregate", () => {
  const problems = verifyShardResults(
    needsFixture({ "journey-presets": { result: "skipped", outputs: {} } }),
  );
  assert.deepEqual(problems, ['journey-presets: result "skipped", expected "success"']);
});

test("a journey shard that ran despite a version-only mode fails the aggregate", () => {
  const problems = verifyShardResults(
    needsFixture({
      mode: "version-only",
      "journey-fresh-app": { result: "success", outputs: {} },
    }),
  );
  assert.deepEqual(problems, [
    'journey-fresh-app: result "success", expected "skipped" in mode "version-only"',
  ]);
});

test("a failed snapshot fails once, with journeys legitimately skipped", () => {
  const problems = verifyShardResults(
    needsFixture({
      snapshot: { result: "failure", outputs: {} },
      "journey-fresh-app": { result: "skipped", outputs: {} },
      "journey-presets": { result: "skipped", outputs: {} },
    }),
  );
  assert.deepEqual(problems, ['snapshot: result "failure", expected "success"']);
});

test("a shard missing from needs is drift, not a pass", () => {
  const needs = needsFixture();
  delete needs["journey-presets"];
  const problems = verifyShardResults(needs);
  assert.deepEqual(problems, [
    "journey-presets: missing from the aggregator's needs — ci.yml and verify-shard-results.mjs drifted",
  ]);
});

test("a shard unknown to the expectations is drift, not a pass", () => {
  const problems = verifyShardResults(
    needsFixture({ rehearsal: { result: "success", outputs: {} } }),
  );
  assert.deepEqual(problems, [
    "rehearsal: not covered by verify-shard-results.mjs — add an expectation",
  ]);
});
