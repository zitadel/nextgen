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
          // front and never re-optimize mid-run. The browser suite's recurring
          // cold-CI failure ("Failed to fetch dynamically imported module …
          // setup-file-with-project-annotations.js") is Vite re-optimizing when
          // it discovers a dep after the browser has started, which invalidates
          // the in-flight module URLs. With discovery off that race cannot
          // happen: a missing dep fails deterministically (and reproducibly on
          // a cold local cache) instead of flaking under CI timing.
          noDiscovery: true,
        },
        // Run the story suites one at a time in a single browser context.
        // `baseTest` defaults `fileParallelism: true`, which spins up several
        // Chromium contexts at once, and each one re-boots the FULL Storybook
        // preview (`.storybook/preview.ts`): the MSW service worker, the a11y
        // runtime, and a cold Vite dep-optimize crawl. On a cold CI runner that
        // startup burst is already expensive; when this PR edits
        // `.moon/workspace.yml` moon marks the entire ~140-task graph affected
        // and runs it concurrently (Go builds, the Spanner emulator JVM,
        // Postgres, every other package's browser `:test`), so the host is
        // saturated exactly while Storybook is launching. Several heavy contexts
        // racing that saturated window is what starves the addon-vitest setup
        // module's request and surfaces as "Failed to fetch dynamically imported
        // module … setup-file-with-project-annotations.js" — identically on
        // every run of this branch, and never on lighter branches where only a
        // handful of tasks are affected. One context loads that setup module
        // once and reuses it for all 13 suites, which keeps the browser
        // footprint small enough to come up under the contended burst. The
        // lighter-weight `@zitadel/components`/`@zitadel/api-mock` browser lanes
        // run the same way under the same contention and stay green.
        test: {
          name: "storybook",
          fileParallelism: false,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
            // Launching Chromium and connecting the orchestrator can take far
            // longer than the default when the CI host is saturated by the
            // full-graph burst above; be patient rather than aborting the run
            // mid-startup.
            connectTimeout: 120_000,
          },
        },
      },
    ],
  },
});
