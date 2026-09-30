/**
 * Shared Vitest `test` defaults, spread into every project's own config:
 *
 *   import { defineConfig } from "vitest/config";
 *   import { baseTest } from "../../vitest.shared.mjs";
 *   export default defineConfig({
 *     test: { ...baseTest, name: "@zitadel/x", environment: "node" },
 *   });
 *
 * It is a plain object (not `defineConfig`/`mergeConfig`) on purpose: the SDK
 * family resolves Vitest 3 (the `sdk` pnpm catalog, pinned there because Qwik 1
 * peers `vite >=5 <8`) while everything else resolves Vitest 4. A plain object
 * of the fields common to both majors is consumed cleanly by either. It ships
 * as `.mjs` + a hand-written `.d.mts` so it resolves under both `bundler` and
 * `nodenext` TypeScript projects (including composite ones) without being pulled
 * into each project's compiled file list.
 *
 * Only genuinely shared fields live here. Per-project axes — `environment`,
 * `plugins`, `resolve.conditions`, `include`, `setupFiles`/`globalSetup`, the
 * unit+browser `projects` split — stay in each project's config.
 *
 * @type {import("./vitest.shared.d.mts").BaseTest}
 */
export const baseTest = {
  watch: false,
  globals: true,
  // Run test files in parallel via the worker pool (Vitest's default, pinned
  // here so no project can silently regress to serial execution). Files within
  // a project run concurrently; moon runs the projects concurrently on top.
  fileParallelism: true,
  // Fail loud when a suite's include matches nothing (a broken glob or all tests
  // removed), restoring the pre-migration behavior. A genuinely test-less lane
  // (login-ui) overrides this to `true` in its own config.
  passWithNoTests: false,
  // Discover both suffixes under src/, so a package can't silently drop a whole
  // suite by matching only one of *.spec / *.test. Packages whose tests live
  // outside src/ (cli → tests/, workspace/cli-journey-e2e → scripts/) or that
  // split into sub-projects override `include` in their own config.
  include: ["src/**/*.{test,spec}.{ts,tsx}"],
  // No shared globalSetup: the only setup work is package-specific (config syncs
  // its meta-schemas; cli builds its dist via a moon dep). Forcing it here would
  // couple every project's tests to another package's inputs. A package that
  // needs setup declares its own `globalSetup` at its package root.
  // Console output plus a machine-readable result report at a uniform path.
  // The path lives in `outputFile` (Vitest's canonical location) rather than the
  // reporter tuple, so a lane that runs concurrently in the same package cwd
  // (e.g. `test:browser`) can override just this via `--outputFile.junit=…`.
  reporters: ["default", "junit"],
  outputFile: { junit: "./test-output/vitest/junit.xml" },
  coverage: {
    provider: "v8",
    reportsDirectory: "./test-output/vitest/coverage",
    // Every source extension in use across the workspace (.ts/.tsx/.svelte),
    // plus .vue defensively for the Vue SDK. Keep in sync with a
    // `find */src -type f` extension sweep when adding a new framework.
    include: ["src/**/*.{ts,tsx,vue,svelte}"],
  },
};

/**
 * Resolve sibling `@zitadel/*` workspace packages to their TypeScript source
 * (matching the repo tsconfig's custom condition), so tests exercise shipped
 * code. Spread into `resolve.conditions` for workspace-source consumers.
 */
export const sourceConditions = ["@zitadel/source"];
