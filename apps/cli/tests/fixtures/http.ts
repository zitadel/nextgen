import { createServer, type RequestListener, type Server } from "node:http";

import { setupServer } from "msw/node";
import { test as base } from "vitest";

import type { ZitadelClient } from "@/lib/backend";
import { testClient } from "../helpers/api-answers";
import { nextPort } from "../helpers/ports";

/** Starts an HTTP server on a free port, answers with `handler`, and returns its base URL. */
export type Serve = (handler: RequestListener, host?: string) => Promise<string>;

/** The HTTP servers a test started, all closed when it ends. */
class Servers {
  private readonly started: Server[] = [];

  /**
   * Starts an HTTP server on a free port.
   *
   * @param handler - Answers each request.
   * @param host - The host to listen on.
   * @returns The server's base URL.
   * @throws Error when the server does not expose a TCP address.
   */
  async start(handler: RequestListener, host = "localhost"): Promise<string> {
    const server = createServer(handler);
    this.started.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, host, () => {
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("the test server did not expose a TCP address");
    }
    return `http://${host}:${String(address.port)}`;
  }

  /**
   * Closes every server and the connections still open to it.
   *
   * @returns Once all of them are closed.
   */
  async dispose(): Promise<void> {
    await Promise.all(
      this.started.map((server) => {
        return new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
          server.closeAllConnections();
        });
      }),
    );
  }
}

/**
 * `test` with the fixtures that put an HTTP server in front of the code under test. Vitest has no
 * way to merge two extended tests, so each helper file extends the one before it and
 * `index.ts` presents the last as the CLI's one `it`.
 *
 * - `server` is an MSW server listening for the test, one that fails a request nothing handled.
 *   Each test adds its own handlers with `server.use(...)`.
 * - `serve` starts an HTTP server on a free port, answers with the handler, and gives back its
 *   base URL; every server it started is closed when the test ends.
 * - `client` is a real CLI client on `TEST_SERVER` (`helpers/api-answers.ts`), for code that takes
 *   one; the test answers what it sends on `server`.
 * - `port` is a port from this worker's own block (see `ports.ts`). A test that needs a second one
 *   calls `nextPort()`. It is here, not in `ports.ts`, because `vitest.config.ts` reads that file's
 *   allocator while the config loads, where a Vitest `test` cannot be extended.
 */
export const test = base.extend<{
  server: ReturnType<typeof setupServer>;
  serve: Serve;
  client: ZitadelClient;
  port: number;
}>({
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
    const servers = new Servers();
    await use((handler, host) => {
      return servers.start(handler, host);
    });
    await servers.dispose();
  },
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async client({}, use) {
    await use(testClient());
  },
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async port({}, use) {
    await use(nextPort());
  },
});
