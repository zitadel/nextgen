import { createServer, type RequestListener, type Server } from "node:http";

import { setupServer } from "msw/node";
import { test as base } from "vitest";

/** Starts an HTTP server on a free port, answers with `handler`, and returns its base URL. */
export type Serve = (handler: RequestListener, host?: string) => Promise<string>;

/**
 * `test` with the fixtures that put an HTTP server in front of the code under test. Vitest has no
 * way to merge two extended tests, so each helper file extends the one before it and
 * `fixtures.ts` presents the last as the CLI's one `it`.
 *
 * - `server` is an MSW server listening for the test, one that fails a request nothing handled.
 *   Each test adds its own handlers with `server.use(...)`.
 * - `serve` starts an HTTP server on a free port, answers with the handler, and gives back its
 *   base URL; every server it started is closed when the test ends.
 */
export const test = base.extend<{
  server: ReturnType<typeof setupServer>;
  serve: Serve;
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
      started.map((server) => {
        return new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      }),
    );
  },
});
