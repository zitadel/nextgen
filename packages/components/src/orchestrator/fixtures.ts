import { setupServer } from "msw/node";

import { sharedHostTest, test as renderTest } from "../test/fixtures.js";

/** The msw interceptor the orchestrator specs share. */
export type Server = ReturnType<typeof setupServer>;

/**
 * Starts an msw interceptor with no handlers that fails any request nothing
 * handled, and stops it again.
 *
 * @param use - Runs the test with the interceptor.
 */
async function withServer(use: (server: Server) => Promise<void>): Promise<void> {
  const server = setupServer();
  server.listen({ onUnhandledRequest: "error" });
  await use(server);
  server.resetHandlers();
  server.close();
}

/**
 * `test` for the orchestrator specs: the rendering fixtures plus `server`, an
 * msw interceptor listening for the test that fails a request nothing handled
 * and is closed when the test ends. A test adds its handlers with
 * `server.use(...)`, or a hook sets the defaults with `server.resetHandlers(...)`.
 */
export const test = renderTest.extend<{ server: Server }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  server: ({}, use) => withServer(use),
});

/** The same fixtures as {@link test}, under the name specs import. */
export const it = test;

/**
 * `test` for an orchestrator spec that keeps one host for the whole file: the
 * file-scoped `host` and `render` of the shared-host fixtures plus the same
 * per-test `server`.
 */
export const sharedHostOrchestratorTest = sharedHostTest.extend<{ server: Server }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  server: ({}, use) => withServer(use),
});

/** The same fixtures as {@link sharedHostOrchestratorTest}, under the name specs import. */
export const sharedHostIt = sharedHostOrchestratorTest;
