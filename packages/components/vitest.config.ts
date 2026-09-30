import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";
import { liquidRaw } from "./vite-liquid-plugin.js";

/** Shared plugins for every project in this config. */
const sharedPlugins = () => [liquidRaw()];

/**
 * One config, two projects, run together by a single `vitest run` (the `test`
 * task) — one aggregated junit, no per-lane scripts or CLI flags:
 *
 * - `unit` (jsdom): the bulk of the suite. Skips the form-associated custom
 *   element checks that jsdom 29 only partially implements.
 * - `browser` (real Chromium via Playwright): the `*.browser.spec.ts` files —
 *   form participation, Enter-to-submit, focus management. Needs a Playwright
 *   Chromium install.
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
