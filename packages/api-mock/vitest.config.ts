import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";

/**
 * Unit lane (node) — the default `vitest run` and the CI gate. The canonical
 * contract test for the mock handlers, running against `msw/node`'s
 * `setupServer`.
 *
 * The browser lane lives in `vitest.browser.config.ts` (run via `test:browser`,
 * not in CI): it smoke-tests the `setupMock(worker)` entry point against
 * `msw/browser` in real Chromium and needs a Playwright install. Its config
 * owns the project selection and its own junit output, so the script needs no
 * CLI flags.
 */
export default defineConfig({
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/api-mock",
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["src/**/*.browser.spec.ts"],
  },
});
