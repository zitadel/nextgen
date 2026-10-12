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
    // Serializing the files keeps the server serving one importer at a time.
    // Per-file iframe isolation is also off — see `isolate: false` below.
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
          // The residual CI flake (#1490) — "Failed to fetch dynamically
          // imported module … setup-file-with-project-annotations.js" — is not a
          // cold-cache race (it strikes an arbitrary story file mid-run, after
          // other files have already imported the same warm setup module). With
          // `isolate: true` the browser orchestrator creates a FRESH iframe per
          // story file, and each iframe re-imports the addon-vitest setup file
          // over HTTP; under the full `moon ci` load any one of those ~dozen
          // repeated imports can be dropped (vitest-dev/vitest#9509). Running the
          // files in one shared iframe imports that setup chain ONCE instead of
          // once per file, so the operation that flakes no longer repeats — this
          // removes the failure rather than retrying through it.
          //
          // Safe here because the preview is already written for a single shared
          // context: one MSW worker for the whole preview, an idempotent
          // `customElements.define`, and a `keyed()` remount that tears down each
          // story's subtree between renders (see `.storybook/preview.ts`). The
          // stateful orchestrator stories are excluded via the `no-test` tag.
          isolate: false,
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
