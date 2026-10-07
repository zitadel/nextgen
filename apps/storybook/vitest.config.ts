import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { flakeDiagLaunchArgs, flakeDiagPlugin } from "../../vitest.flake-diag.mjs";
import { baseTest } from "../../vitest.shared.mjs";
import { optimizeDepsExclude, optimizeDepsInclude } from "./.storybook/optimize-deps.js";

const dir = dirname(fileURLToPath(import.meta.url));

/**
 * `@storybook/addon-vitest` transforms the stories into Vitest tests and runs
 * them in real Chromium (Playwright). Each story gets a render smoke test, its
 * `play` function (interaction), and the `a11y: { test: "error" }` checks from
 * `.storybook/preview.ts`. This is the parity/behaviour gate that replaced the
 * old `console-e2e` visual sweep, and it runs in CI via `moon ci :test`.
 *
 * Orchestrator stories are tagged `no-test` (they drive real network + the MSW
 * worker; their behaviour is covered by the `@zitadel/components` specs).
 */
export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/storybook",
    projects: [
      {
        extends: true,
        // NOTE: unlike the other packages we do NOT pin cacheDir to `.vitest`
        // here — the Storybook Vitest addon (`storybookTest`) manages its own
        // Vite instance and keeps its cache under `node_modules/.vite`
        // regardless of this setting, so `storybook:test` has no `.vitest`
        // output in moon.yml.
        plugins: [
          storybookTest({
            configDir: join(dir, ".storybook"),
            storybookScript: "storybook dev -p 6006 --no-open",
            tags: { exclude: ["no-test"] },
          }),
          flakeDiagPlugin("storybook"),
        ],
        optimizeDeps: {
          exclude: optimizeDepsExclude,
          include: optimizeDepsInclude,
          // Forbid on-the-fly discovery: optimize ONLY the `include` list up
          // front and never re-optimize mid-run. The browser suite's recurring
          // cold-CI failure ("Failed to fetch dynamically imported module …
          // setup-file-with-project-annotations.js") is Vite re-optimizing when
          // it discovers a dep after the browser has started, which invalidates
          // the in-flight module URLs. With discovery off that race cannot
          // happen: a missing dep fails deterministically (and reproducibly on
          // a cold local cache) instead of flaking under CI timing.
          noDiscovery: true,
        },
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            provider: playwright({ launchOptions: { args: flakeDiagLaunchArgs("storybook") } }),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
