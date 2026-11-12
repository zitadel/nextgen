import assert from "node:assert/strict";
import { test } from "vitest";

import { criticalPath, renderSummary } from "./turbo-run-summary.mjs";

function task(taskId, start, end, { deps = [], hit = false, source = "LOCAL", exitCode = 0 } = {}) {
  return {
    taskId,
    dependencies: deps,
    cache: hit ? { status: "HIT", source, timeSaved: 5000 } : { status: "MISS" },
    execution: { startTime: start, endTime: end, exitCode },
  };
}

// generate (0–10s) → build (10–40s) → test (60–100s, queued 20s);
// lint runs beside them and ends first; the cached codegen ends at 0.
const summary = {
  execution: { startTime: 0, endTime: 100_000 },
  tasks: [
    task("a#generate", 0, 10_000),
    task("a#build", 10_000, 40_000, { deps: ["a#generate"] }),
    task("a#test", 60_000, 100_000, { deps: ["a#build", "a#codegen"] }),
    task("a#codegen", 0, 0, { hit: true, source: "REMOTE" }),
    task("b#lint", 0, 50_000),
  ],
};

test("walks back from the last task through the dependency that finished last", () => {
  const path = criticalPath(summary.tasks);
  assert.deepEqual(
    path.map(({ task, wait }) => [task.taskId, wait]),
    [
      ["a#generate", 0],
      ["a#build", 0],
      ["a#test", 20_000],
    ],
  );
});

test("renders totals, the critical path and the slowest tasks that ran", () => {
  const md = renderSummary(summary);
  // 4 ran for 10+30+40+50 = 130s over 100s of wall time.
  assert.match(md, /\| 1m 40s \| 5 \| 4 \| 1 \(1 remote\) \| 0 \| 2m 10s \| 1\.3× \| 5\.0s \|/);
  assert.match(md, /\| `a#test` \| \+1m 00s \| 40\.0s \| 20\.0s \| miss \|/);
  const slowest = md.slice(md.indexOf("### Slowest"));
  assert.ok(slowest.indexOf("`b#lint`") < slowest.indexOf("`a#test`"));
  assert.ok(!slowest.includes("`a#codegen`"));
});

test("names failed tasks", () => {
  const failing = {
    ...summary,
    tasks: [...summary.tasks, task("c#test", 0, 1_000, { exitCode: 1 })],
  };
  assert.match(renderSummary(failing), /\*\*Failed:\*\* `c#test`/);
});
