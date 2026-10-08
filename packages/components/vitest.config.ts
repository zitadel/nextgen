import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";
import { liquidRaw } from "./vite-liquid-plugin.js";

/** Shared plugins for every project in this config. */
const sharedPlugins = () => [liquidRaw()];

/**
 * Two projects in one config, selected per lane (no separate config files):
 *
 * - `unit` (jsdom): the bulk of the suite. The fast local `test` = `vitest run
 *   --project unit`. Skips the form-associated custom-element checks that
 *   jsdom 29 only partially implements.
 * - `browser` (real Chromium via Playwright): `*.browser.spec.ts` — form
 *   participation, Enter-to-submit, focus management. Local-only selector
 *   `test:browser` = `vitest run --project browser` (heavy Chromium cold start).
 *
 * The CI gate is `test:all` = `vitest run`, which runs both projects in one
 * process and emits one aggregated junit.xml.
 */
export default defineConfig({
  cacheDir: ".vitest",
  plugins: sharedPlugins(),
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/components",
    projects: [
      {
        // Each project is its own Vite instance, so it needs its own cacheDir;
        // a distinct subdir under the shared .vitest keeps the two deps caches
        // from colliding.
        cacheDir: ".vitest/unit",
        plugins: sharedPlugins(),
        resolve: { conditions: sourceConditions },
        test: {
          name: "unit",
          globals: true,
          // Specs import atoms directly, past the entries that silence Lit's
          // dev-mode notice; load the same module first (see the module).
          setupFiles: ["src/internal/lit-dev-mode.ts"],
          environment: "jsdom",
          include: ["src/**/*.spec.ts"],
          exclude: ["src/**/*.browser.spec.ts"],
        },
      },
      {
        cacheDir: ".vitest/browser",
        plugins: sharedPlugins(),
        resolve: { conditions: sourceConditions },
        test: {
          name: "browser",
          globals: true,
          setupFiles: ["src/internal/lit-dev-mode.ts"],
          // Serialize browser files so parallel Chromium contexts do not
          // overwhelm the Vitest Vite server under CI load, which flakes the
          // setup-module fetch (vitest-dev/vitest#9509). The jsdom `unit`
          // project above still runs in parallel.
          fileParallelism: false,
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
