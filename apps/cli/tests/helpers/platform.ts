import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { setupServer } from "msw/node";
import type { SetupServerApi } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

/**
 * Starts the mock platform for a spec file and resets it between tests.
 *
 * Call it once at module scope and keep the returned server if the spec needs
 * `server.use(...)` to make the platform answer differently for one test —
 * a surface the shared handlers do not cover yet, or a failure they cannot
 * express. Faking the platform's HTTP is the point of a spec; faking one of
 * our own modules is not (`tests/AGENTS.md`).
 */
export function usePlatformMock(): SetupServerApi {
  const server = setupServer(...setupPlatformHandlers());

  beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
  afterAll(() => server.close());
  afterEach(() => {
    server.resetHandlers();
    resetPlatformStore();
  });

  return server;
}
