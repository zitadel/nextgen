import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";
import { flakeDiagLaunchArgs, flakeDiagPlugin } from "../../vitest.flake-diag.mjs";

/**
 * Two projects in one config, selected per lane (no separate config files):
 *
 * - `unit` (node): the canonical contract test for the mock handlers against
 *   `msw/node`'s `setupServer`. The fast local `test` = `vitest run --project
 *   unit`.
 * - `browser` (real Chromium via Playwright): smoke-tests `setupMock(worker)`
 *   against `msw/browser`. Local-only selector `test:browser` = `vitest run
 *   --project browser`.
 *
 * The CI gate is `test:all` = `vitest run`, which runs both projects in one
 * process and emits one aggregated junit.xml.
 */
export default defineConfig({
  cacheDir: ".vitest",
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/api-mock",
    projects: [
      {
        // Each project is its own Vite instance, so it needs its own cacheDir;
        // a distinct subdir under the shared .vitest keeps the two deps caches
        // from colliding.
        cacheDir: ".vitest/unit",
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
        cacheDir: ".vitest/browser",
        plugins: [flakeDiagPlugin("api-mock")],
        resolve: { conditions: sourceConditions },
        test: {
          name: "browser",
          globals: true,
          include: ["src/**/*.browser.spec.ts"],
          browser: {
            enabled: true,
            provider: playwright({ launchOptions: { args: flakeDiagLaunchArgs("api-mock") } }),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
