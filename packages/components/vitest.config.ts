import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";
import { liquidRaw } from "./vite-liquid-plugin.ts";

/** Browser specs that run only in the `closed-roots` project. */
const closedRootsSpecs = ["src/**/*.closed.browser.spec.ts"];

/** Shared plugins for every project in this config. */
const sharedPlugins = () => [liquidRaw()];

/**
 * Three projects in one config, selected per lane (no separate config files):
 *
 * - `unit` (jsdom): the bulk of the suite. The fast local lane is `test:unit`
 *   = `vitest run --project unit`. Skips the form-associated custom-element
 *   checks that jsdom 29 only partially implements.
 * - `browser` (real Chromium via Playwright): `*.browser.spec.ts` — form
 *   participation, Enter-to-submit, focus management. Local-only selector
 *   `test:browser` = `vitest run --project browser --project closed-roots`
 *   (heavy Chromium cold start).
 * - `closed-roots` (real Chromium, the shipped build's closed shadow roots):
 *   `*.closed.browser.spec.ts`. Every other project runs open roots.
 *
 * The CI gate is `test:all` = `vitest run`, which runs every project in one
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
          exclude: closedRootsSpecs,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
      {
        // The browser project with the shipped build's shadow root mode
        // forced on: the only place the closed roots run, because a custom
        // element registers once per page and the mode is fixed when the
        // module loads. Same define as the `define` in tsdown.config.ts.
        cacheDir: ".vitest/closed-roots",
        plugins: sharedPlugins(),
        resolve: { conditions: sourceConditions },
        define: { __ZITADEL_SHADOW_ROOT_MODE__: JSON.stringify("closed") },
        test: {
          name: "closed-roots",
          globals: true,
          setupFiles: ["src/internal/lit-dev-mode.ts"],
          fileParallelism: false,
          include: closedRootsSpecs,
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
