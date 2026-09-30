import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";
import { liquidRaw } from "./vite-liquid-plugin.js";

/** Shared plugins for every project in this config. */
const sharedPlugins = () => [liquidRaw()];

/**
 * Two projects in one config, selected per lane (no separate config files):
 *
 * - `unit` (jsdom): the bulk of the suite; the default `test` = `vitest run
 *   --project unit`, and the CI gate. Skips the form-associated custom-element
 *   checks that jsdom 29 only partially implements.
 * - `browser` (real Chromium via Playwright): `*.browser.spec.ts` — form
 *   participation, Enter-to-submit, focus management. The opt-in `test:browser`
 *   = `vitest run --project browser` (heavy cold start, `runInCI: false`).
 *
 * `test:all` = `vitest run` runs both in one process.
 */
export default defineConfig({
  plugins: sharedPlugins(),
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/components",
    projects: [
      {
        plugins: sharedPlugins(),
        resolve: { conditions: sourceConditions },
        test: {
          name: "unit",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.spec.ts"],
          exclude: ["src/**/*.browser.spec.ts"],
        },
      },
      {
        plugins: sharedPlugins(),
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
