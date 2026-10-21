import assert from "node:assert/strict";
import { fstatSync } from "node:fs";
import { afterEach, test, vi } from "vitest";

import { runReplayed } from "./dev-process.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

// Records what is written to `stream` and finishes each write a little later,
// as a pipe does while its reader is behind.
function recordWrites(stream) {
  const record = { text: "", unfinished: 0 };
  vi.spyOn(stream, "write").mockImplementation((chunk, callback) => {
    record.text += chunk;
    record.unfinished += 1;
    setTimeout(() => {
      record.unfinished -= 1;
      callback?.();
    }, 20);
    return true;
  });
  return record;
}

test("runReplayed runs the command on a stdout of its own", async () => {
  const stdout = recordWrites(process.stdout);
  recordWrites(process.stderr);
  const own = fstatSync(1, { bigint: true });
  const script =
    'const s = require("node:fs").fstatSync(1, { bigint: true }); process.stdout.write(s.dev + ":" + s.ino);';

  await runReplayed(process.execPath, ["-e", script]);

  assert.equal(stdout.unfinished, 0);
  // A socket's st_dev reads as -1 on macOS.
  assert.match(stdout.text, /^-?\d+:\d+$/);
  assert.notEqual(stdout.text, `${own.dev}:${own.ino}`);
});

test("runReplayed replays a failed command's output before it rejects", async () => {
  const stdout = recordWrites(process.stdout);
  const stderr = recordWrites(process.stderr);
  const script =
    'process.stdout.write("x".repeat(200000)); process.stderr.write("boom"); process.exitCode = 3;';

  await assert.rejects(runReplayed(process.execPath, ["-e", script]), (error) => {
    // Every write has finished, so a process.exit at this point keeps it all.
    assert.equal(stdout.unfinished + stderr.unfinished, 0);
    assert.equal(error.code, 3);
    assert.match(error.message, /failed with exit 3$/);
    return true;
  });
  assert.equal(stdout.text, "x".repeat(200_000));
  assert.equal(stderr.text, "boom");
});
