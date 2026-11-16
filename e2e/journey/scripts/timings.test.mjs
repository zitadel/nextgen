import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  formatMarkdownTable,
  formatOffset,
  formatPhases,
  formatTextTable,
  readPhases,
  timePhase,
  timingTable,
} from "./timings.mjs";

/** A clock that returns the given readings in turn. */
function steppedClock(...readings) {
  let index = 0;
  return () => readings[index++];
}

test("timePhase records what the phase returned and how long it took", async () => {
  const phases = [];
  const result = await timePhase(
    phases,
    "setup",
    async () => "scaffolded",
    steppedClock(100, 2350.4),
  );
  assert.equal(result, "scaffolded");
  assert.deepEqual(phases, [{ phase: "setup", ms: 2250, ok: true }]);
});

test("timePhase records a failed phase and rethrows its error", async () => {
  const phases = [];
  await assert.rejects(
    timePhase(
      phases,
      "start",
      async () => {
        throw new Error("start exited 1");
      },
      steppedClock(0, 900),
    ),
    /start exited 1/,
  );
  assert.deepEqual(phases, [{ phase: "start", ms: 900, ok: false }]);
});

test("readPhases reads prepare-app's file and treats a missing or broken one as empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-journey-timings-test-"));
  try {
    const path = join(dir, "timings.json");
    assert.deepEqual(await readPhases(path), []);
    await writeFile(path, `${JSON.stringify([{ phase: "doctor", ms: 9800, ok: true }])}\n`);
    assert.deepEqual(await readPhases(path), [{ phase: "doctor", ms: 9800, ok: true }]);
    await writeFile(path, "[{");
    assert.deepEqual(await readPhases(path), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatOffset prints minutes and zero-padded seconds", () => {
  assert.equal(formatOffset(0), "0:00");
  assert.equal(formatOffset(9_999), "0:09");
  assert.equal(formatOffset(72_400), "1:12");
  assert.equal(formatOffset(3_600_000), "60:00");
});

test("formatPhases lists the shared phases in seconds", () => {
  assert.equal(
    formatPhases([
      { phase: "browsers", ms: 1234, ok: true },
      { phase: "registry", ms: 12_000, ok: true },
    ]),
    "browsers 1.2s, registry 12.0s",
  );
});

test("timingTable has a row per lane and a column per phase some lane ran", () => {
  const rows = timingTable([
    {
      id: "fresh-app/next",
      began: 16_200,
      ended: 143_900,
      phases: [
        { phase: "doctor", ms: 9_800, ok: true },
        { phase: "start", ms: 12_100, ok: true },
        { phase: "setup", ms: 39_300, ok: true },
        { phase: "drift", ms: 14_200, ok: true },
        { phase: "app", ms: 8_100, ok: true },
        { phase: "playwright", ms: 41_000, ok: true },
        { phase: "teardown", ms: 3_200, ok: true },
      ],
    },
    {
      id: "testkit/next",
      began: 105_000,
      ended: 160_000,
      failed: true,
      phases: [
        { phase: "doctor", ms: 3_100, ok: true },
        { phase: "start", ms: 5_000, ok: true },
        { phase: "setup", ms: 20_200, ok: true },
        { phase: "stop", ms: 1_000, ok: true },
        { phase: "install", ms: 12_300, ok: false },
        { phase: "teardown", ms: 2_000, ok: true },
      ],
    },
  ]);

  assert.deepEqual(rows, [
    [
      "lane",
      "began",
      "doctor",
      "start",
      "setup",
      "drift",
      "stop",
      "install",
      "app",
      "playwright",
      "teardown",
      "total",
      "result",
    ],
    [
      "fresh-app/next",
      "0:16",
      "9.8",
      "12.1",
      "39.3",
      "14.2",
      "-",
      "-",
      "8.1",
      "41.0",
      "3.2",
      "127.7",
      "passed",
    ],
    [
      "testkit/next",
      "1:45",
      "3.1",
      "5.0",
      "20.2",
      "-",
      "1.0",
      "12.3",
      "-",
      "-",
      "2.0",
      "55.0",
      "failed in install",
    ],
  ]);
});

test("timingTable leaves out phases no lane ran and keeps unlisted ones", () => {
  const rows = timingTable([
    {
      id: "journey/vue",
      began: 0,
      ended: 1_000,
      failed: true,
      phases: [
        { phase: "warmup", ms: 300, ok: true },
        { phase: "doctor", ms: 200, ok: true },
      ],
    },
  ]);
  assert.deepEqual(rows, [
    ["lane", "began", "doctor", "warmup", "total", "result"],
    // A lane that failed outside a timed phase still reads as failed.
    ["journey/vue", "0:00", "0.2", "0.3", "1.0", "failed"],
  ]);
});

test("formatTextTable aligns names left and times right", () => {
  const text = formatTextTable([
    ["lane", "began", "setup", "result"],
    ["fresh-app/next", "0:16", "39.3", "passed"],
    ["remote/react", "1:52", "-", "failed in setup"],
  ]);
  assert.equal(
    text,
    [
      "lane            began  setup  result",
      "fresh-app/next   0:16   39.3  passed",
      "remote/react     1:52      -  failed in setup",
    ].join("\n"),
  );
});

test("formatMarkdownTable renders a GitHub table with the same alignment", () => {
  const markdown = formatMarkdownTable([
    ["lane", "began", "setup", "result"],
    ["fresh-app/next", "0:16", "39.3", "passed"],
  ]);
  assert.equal(
    markdown,
    [
      "| lane | began | setup | result |",
      "| :-- | --: | --: | :-- |",
      "| fresh-app/next | 0:16 | 39.3 | passed |",
    ].join("\n"),
  );
});
