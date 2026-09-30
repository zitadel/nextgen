import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";

/**
 * One config, two projects, run together by a single `vitest run` (the `test`
 * task) — one aggregated junit, no per-lane scripts or CLI flags:
 *
 * - `unit` (node): the canonical contract test for the mock handlers, against
 *   `msw/node`'s `setupServer`.
 * - `browser` (real Chromium via Playwright): smoke-tests the `setupMock(worker)`
 *   entry against `msw/browser`. Needs a Playwright Chromium install.
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
