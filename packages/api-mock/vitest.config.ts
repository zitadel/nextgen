import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";

/**
 * Two projects in one config, selected per lane (no separate config files):
 *
 * - `unit` (node): the canonical contract test for the mock handlers against
 *   `msw/node`'s `setupServer`. The default `test` = `vitest run --project unit`,
 *   and the CI gate.
 * - `browser` (real Chromium via Playwright): smoke-tests `setupMock(worker)`
 *   against `msw/browser`. The opt-in `test:browser` = `vitest run --project
 *   browser` (`runInCI: false`).
 *
 * `test:all` = `vitest run` runs both in one process.
 */
export default defineConfig({
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/api-mock",
    projects: [
      {
        resolve: { conditions: sourceConditions },
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          include: ["src/**/*.spec.ts"],
          exclude: ["src/**/*.browser.spec.ts"],
        },
      },
      {
        resolve: { conditions: sourceConditions },
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
