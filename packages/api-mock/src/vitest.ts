/**
 * Vitest harness that serves the mock Flow API to a node or jsdom suite
 * through `msw/node`. Browser-mode suites use `./vitest-browser` instead.
 *
 * Call it once from a `setupFiles` entry:
 *
 * ```ts
 * import { serveMockFlowApi } from "@zitadel/api-mock/vitest";
 *
 * serveMockFlowApi();
 * ```
 *
 * A widget mounted by a spec then talks to the same handlers the components
 * suite and Storybook use. Requests the mock does not serve are errors rather
 * than reaching the network. jsdom gives the suite a `location`, so a relative
 * `proxyPath` such as `/__nextgen` resolves against it as it would in a
 * browser.
 */
import { setupServer } from "msw/node";

import { registerMockFlowApi, type MockFlowApi } from "./vitest-harness.js";

export type { MockFlowApi };

export function serveMockFlowApi(): MockFlowApi {
  return registerMockFlowApi((handlers) => {
    const server = setupServer(...handlers);
    return {
      start: () => server.listen({ onUnhandledRequest: "error" }),
      use: (next) => server.resetHandlers(...next),
      stop: () => server.close(),
    };
  });
}
