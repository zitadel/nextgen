import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setupServer } from "msw/node";
import { test as base } from "vitest";

import { nextPort } from "./ports";

/** Starts an HTTP server on a free port, answers with `handler`, and returns its base URL. */
export type Serve = (handler: RequestListener, host?: string) => Promise<string>;

/**
 * Give every directory under a path its owner's permissions back, so a test
 * that took them away (to see how a directory no one may read is refused) does
 * not leave a tree that cannot be removed. A file needs none: removing one
 * depends only on the directory it is in.
 *
 * @param path - The path to unlock, with everything under it.
 */
async function unlock(path: string): Promise<void> {
  const stats = await lstat(path).catch(() => {
    return undefined;
  });
  if (stats === undefined || !stats.isDirectory()) {
    return;
  }
  await chmod(path, 0o755);
  for (const name of await readdir(path)) {
    await unlock(join(path, name));
  }
}

async function withTempDir(use: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-"));
  try {
    await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(async () => {
      await unlock(dir);
      await rm(dir, { recursive: true, force: true });
    });
  }
}

/**
 * `test` with fixtures: a test that names one in its first argument gets it,
 * and the teardown runs after the test whether it passed or not.
 *
 * - `dir` is a fresh temp directory, removed when the test ends.
 * - `other` is a second one, for a test that needs two apart.
 * - `server` is an MSW server listening for the test, one that fails a request nothing handled.
 * - `serve` starts an HTTP server on a free port, answers with the handler, and gives back its base
 *   URL; every server it started is closed when the test ends.
 * - `port` is a port from this worker's own block (see `ports.ts`), for a test that hands one to the
 *   CLI. A test that needs a second one calls `nextPort()`.
 */
export const test = base.extend<{
  dir: string;
  other: string;
  server: ReturnType<typeof setupServer>;
  serve: Serve;
  port: number;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  dir: ({}, use) => withTempDir(use),
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  other: ({}, use) => withTempDir(use),
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async server({}, use) {
    const server = setupServer();
    server.listen({ onUnhandledRequest: "error" });
    await use(server);
    server.resetHandlers();
    server.close();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async serve({}, use) {
    const started: Server[] = [];
    await use(async (handler, host = "localhost") => {
      const server = createServer(handler);
      started.push(server);
      await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("the test server did not expose a TCP address");
      }
      return `http://${host}:${String(address.port)}`;
    });
    await Promise.all(
      started.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  },
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  port: ({}, use) => use(nextPort()),
});

export { test as it };
