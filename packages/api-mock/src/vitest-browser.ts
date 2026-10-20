/**
 * Vitest harness that serves the mock Flow API to a browser-mode suite
 * through `msw/browser`. Node and jsdom suites use `./vitest` instead.
 *
 * Call it once from a `setupFiles` entry, and serve this package's
 * `mockServiceWorker.js` from the test origin by pointing the Vitest config's
 * `publicDir` at `apiMockPublicDir` (from `@zitadel/api-mock/public-dir`):
 *
 * ```ts
 * import { serveMockFlowApi } from "@zitadel/api-mock/vitest-browser";
 *
 * serveMockFlowApi();
 * ```
 *
 * The worker starts `quiet`, so MSW does not log every intercepted request to
 * the browser console. Requests the mock does not serve are still errors.
 */
import { setupWorker } from "msw/browser";

import { registerMockFlowApi, type MockFlowApi } from "./vitest-harness.js";

export type { MockFlowApi };

export function serveMockFlowApi(): MockFlowApi {
  return registerMockFlowApi((handlers) => {
    const worker = setupWorker(...handlers);
    return {
      start: () => worker.start({ onUnhandledRequest: "error", quiet: true }),
      use: (next) => worker.resetHandlers(...next),
      stop: () => worker.stop(),
    };
  });
}
