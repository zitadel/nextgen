import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "vitest";

/**
 * Creates a fresh temp directory, hands it to the test and removes it afterwards.
 *
 * @param {(dir: string) => Promise<void>} use - Runs the test with the directory.
 * @returns {Promise<void>} Resolves once the test ended and the directory is gone.
 */
async function withTempDir(use) {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-journey-test-"));
  await use(dir);
  await rm(dir, { recursive: true, force: true });
}

/**
 * Closes a server, ignoring one that is not listening any more.
 *
 * @param {import("node:net").Server} server - The server to close.
 * @returns {Promise<void>} Resolves once the server no longer accepts connections.
 */
function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/**
 * `test` for the journey harness scripts, with fixtures a test names in its first argument.
 *
 * - `dir` is a fresh temp directory, removed when the test ends.
 * - `other` is a second one, for a test that needs two apart.
 * - `listen` makes a server listen on a port the OS picks and returns that port; every server it
 *   was given is closed when the test ends.
 */
export const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  dir: ({}, use) => withTempDir(use),
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  other: ({}, use) => withTempDir(use),
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async listen({}, use) {
    const started = [];
    await use(async (server, host = "127.0.0.1") => {
      started.push(server);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, host, resolve);
      });
      return server.address().port;
    });
    await Promise.all(started.map(closeServer));
  },
});
