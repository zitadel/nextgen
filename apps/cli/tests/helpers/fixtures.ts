import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test as base } from "./daemon";
import type { RecordedLog } from "./log";
import { removeTree } from "./scratch";
import type { TerminalFixture } from "./terminal";

export type { Serve } from "./http";

/**
 * Makes a temp directory, hands it to the test, and removes it when the test is over, giving back
 * the permissions the test took away if it had to.
 *
 * @param use - Runs the test with the directory.
 * @returns Once the directory is gone.
 */
async function withTempDir(use: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-"));
  await use(dir);
  await removeTree(dir);
}

/**
 * The CLI's one `test`: every fixture, from the helper file named for what it provides. Vitest
 * cannot merge extended tests, so each of those files extends the one before it and this adds the
 * last two. A test that names a fixture in its first argument gets it, and the teardown runs after
 * the test whether it passed or not.
 *
 * - `dir` is a fresh temp directory, removed when the test ends.
 * - `other` is a second one, for a test that needs two apart.
 * - `server` and `serve` are in `http.ts`: an MSW server that fails a request nothing handled, and
 *   an HTTP server on a free port.
 * - `port` is in `port.ts`: a port from this worker's own block.
 * - `recorded` is in `log.ts`: what the code under test said through `log`.
 * - `terminal` is in `terminal.ts`: the terminal the run is at, and its controls.
 * - `clock` is in `clock.ts`: fake timers the test advances.
 * - `daemon` is in `daemon.ts`: processes that are ended when the test ends.
 */
export const test = base.extend<{
  dir: string;
  other: string;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  dir: ({}, use) => withTempDir(use),
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  other: ({}, use) => withTempDir(use),
});

/**
 * `test` that records what is said through `log` in every test, and stops recording when it ends.
 * `recorded` is the sink, as in `test`, to read the lines or to stop it early.
 */
export const recording = test.extend<{ listening: RecordedLog }>({
  listening: [
    async ({ recorded }, use) => {
      await use(recorded);
    },
    { auto: true },
  ],
});

/**
 * `recording` with the terminal the run is at in every test: stdout and stdin are patched as
 * `terminal` does it, and given back when the test ends. `terminal` and `recorded` are the same
 * ones `test` has.
 */
export const atScreenRecording = recording.extend<{ atTheTerminal: TerminalFixture }>({
  atTheTerminal: [
    async ({ terminal }, use) => {
      await use(terminal);
    },
    { auto: true },
  ],
});

export { test as it };
