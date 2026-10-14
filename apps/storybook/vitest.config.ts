import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";
import { optimizeDepsExclude, optimizeDepsInclude } from "./.storybook/optimize-deps.ts";

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
    // Run story files one at a time. main's `optimizeDeps.noDiscovery` (below)
    // fixes the re-optimization cause of the CI "Failed to fetch dynamically
    // imported module" flake, but parallel Chromium contexts still overwhelm
    // the Vitest Vite server under the full `moon ci` load (vitest-dev/vitest#9509).
    // Serializing the files keeps the server serving one importer at a time;
    // per-file isolation stays on (this is not `isolate: false`).
    fileParallelism: false,
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
        ],
        optimizeDeps: {
          exclude: optimizeDepsExclude,
          include: optimizeDepsInclude,
          // Forbid on-the-fly discovery: optimize ONLY the `include` list up
          // front and never re-optimize mid-run. A dep discovered after the
          // browser has started makes Vite re-optimize, which invalidates the
          // in-flight module URLs ("Failed to fetch dynamically imported
          // module"). With discovery off that race cannot happen: a missing dep
          // fails deterministically (and reproducibly on a cold local cache)
          // instead of flaking under CI timing. The same message in CI, on
          // `setup-file-with-project-annotations.js`, came from Chromium
          // aborting requests on a network change instead; see ci.yml's "Keep
          // Docker's interface churn away from Chromium" step. (#1490)
          noDiscovery: true,
        },
        test: {
          name: "storybook",
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
