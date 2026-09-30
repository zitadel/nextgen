import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";

/**
 * Two projects, mirroring `packages/components/vitest.config.ts`:
 *
 * - `unit` — runs in node mode against `msw/node`'s `setupServer`. The
 *   canonical contract test for the mock handlers; runs in CI as the
 *   default `pnpm test` target. Picks up `*.spec.ts` (excluding the
 *   browser variant).
 * - `browser` — runs in real Chromium via Playwright against
 *   `msw/browser`'s `setupWorker`. Smoke-tests the `setupMock(worker)`
 *   browser entry point that the dev playground uses. Picks up
 *   `*.browser.spec.ts`. Requires a Playwright browser install
 *   (`pnpm exec playwright install`); not run in CI.
 *
 * `pnpm test` runs the unit project. `pnpm test:browser` runs the
 * browser project. `pnpm test:all` runs both.
 */
export default defineConfig({
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/api-mock",
    projects: [
      {
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          include: ["src/**/*.spec.ts"],
          exclude: ["src/**/*.browser.spec.ts"],
        },
      },
      {
        test: {
          name: "browser",
          globals: true,
          include: ["src/**/*.browser.spec.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
