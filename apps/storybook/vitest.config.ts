import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

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
    // Run story files one at a time. `@storybook/addon-vitest` runs each story
    // file in a real Chromium context that dynamically imports the addon's
    // setup module from the Vitest Vite dev server. When many files start in
    // parallel on a loaded CI runner, the server is not ready to serve that
    // module and the browser throws "Failed to fetch dynamically imported
    // module" (vitest-dev/vitest#9509, storybookjs/storybook#33347). Serializing
    // the files keeps the dev server responsive to one importer at a time. This
    // is not `isolate: false` — per-file isolation stays on, so story state
    // still cannot leak between files.
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
