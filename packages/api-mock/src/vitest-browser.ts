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
 * the browser console. Requests the mock does not serve are still errors,
 * except the module requests Vite's dev server answers.
 */
import { setupWorker } from "msw/browser";

import { registerMockFlowApi, type MockFlowApi } from "./vitest-harness.js";

export type { MockFlowApi };

const DEV_SERVER_MODULES = /^\/(?:@|src\/|node_modules\/)/;

export function serveMockFlowApi(): MockFlowApi {
  return registerMockFlowApi((handlers) => {
    const worker = setupWorker(...handlers);
    return {
      start: () =>
        worker.start({
          // Vite's dev server serves modules from these paths, and a page that
          // loads code lazily (a resumed Qwik container) imports them after the
          // worker has started. They are not API calls, so they pass through.
          onUnhandledRequest: (request, print) => {
            if (DEV_SERVER_MODULES.test(new URL(request.url).pathname)) {
              return;
            }
            print.error();
          },
          quiet: true,
        }),
      use: (next) => worker.resetHandlers(...next),
      stop: () => worker.stop(),
    };
  });
}
