/**
 * Shared Vitest `test` defaults, spread into every project's own config:
 *
 *   import { defineConfig } from "vitest/config";
 *   import { baseTest } from "../../vitest.shared.mjs";
 *   export default defineConfig({
 *     test: { ...baseTest, name: "@zitadel/x", environment: "node" },
 *   });
 *
 * It is a plain object (not `defineConfig`/`mergeConfig`) on purpose: every
 * project resolves Vitest 4 from the root catalog, but a plain object of the
 * shared `test` fields stays trivially assignable and keeps this base decoupled
 * from any one Vitest version's config type. It ships as `.mjs` + a hand-written
 * `.d.mts` so it resolves under both `bundler` and `nodenext` TypeScript
 * projects (including composite ones) without being pulled into each project's
 * compiled file list.
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
  // outside src/ (cli → tests/, e2e → journey/scripts/) or that
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

/**
 * A Vitest project that runs specs inside Vercel's `edge-runtime` VM (the
 * `@edge-runtime/vm` devDependency), whose globals are the WinterTC minimum
 * set: no DOM, no `Buffer`, no Node built-ins. A spec that passes there also
 * works on any runtime offering that subset, Cloudflare Workers included.
 *
 * Dependencies resolve with the `browser` condition, as Wrangler and Next
 * bundle for the edge, so a dependency that only works with a DOM (Lit's
 * browser build, for one) fails to load here instead of resolving to its Node
 * build, which would hide it. Add it to a config's `projects`:
 *
 *   projects: [edgeProject({ include: ["src/jwt.spec.ts"] }), ...]
 *
 * `conditions` are extra resolve conditions, e.g. `sourceConditions`; `alias`
 * is the package's own `resolve.alias`.
 *
 * @param {import("./vitest.shared.d.mts").EdgeProjectOptions} options
 * @returns {import("./vitest.shared.d.mts").EdgeProject}
 */
export function edgeProject({ include, exclude = [], conditions = [], alias = {} }) {
  return {
    cacheDir: ".vitest/edge",
    resolve: { conditions, alias },
    ssr: { resolve: { conditions: ["browser", ...conditions] } },
    test: { name: "edge", globals: true, environment: "edge-runtime", include, exclude },
  };
}
