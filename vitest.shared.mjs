import { globSync } from "node:fs";
import { builtinModules } from "node:module";

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
 * The specs that run only in the edge VM: `<entry>.edge.<spec|test>.<ext>`, the
 * spec of the entry `<entry>` with the suffix the package uses for its tests
 * (see `packages/AGENTS.md`). `edgeProject()` always runs them, and the
 * package's other projects leave them out.
 */
export const edgeSpecs = "src/**/*.edge.{test,spec}.{ts,tsx}";

/**
 * Resolve sibling `@zitadel/*` workspace packages to their TypeScript source
 * (matching the repo tsconfig's custom condition), so tests exercise shipped
 * code. Spread into `resolve.conditions` for workspace-source consumers.
 */
export const sourceConditions = ["@zitadel/source"];

/** Files that only the test run loads: they may use Node built-ins to arrange a scenario. */
const TEST_FILE =
  /(\.(spec|test)\.[cm]?[jt]sx?$|[\\/](__tests__|__fixtures__)[\\/]|[\\/]test-setup\.[cm]?[jt]s$)/;

/**
 * A static or dynamic import of a Node built-in, by `node:` prefix or bare
 * name, in transpiled code. Types are already erased there, so a built-in used
 * only by a type import does not count.
 */
const BUILTIN_IMPORT = new RegExp(
  String.raw`\b(?:from\s*|import\s*\(?\s*)["'](?:node:)?(${builtinModules
    .filter((name) => !name.startsWith("_"))
    .map((name) => name.replace("/", String.raw`\/`))
    .join("|")})["']`,
);

/**
 * Fails the run when code under test imports a Node built-in.
 *
 * Vitest hands `node:*` imports to Node before the edge VM or a resolver sees
 * them, so without this a dependency on `node:crypto` loads fine in a spec and
 * breaks only once deployed. The check reads every module Vite transforms, so
 * the project also inlines its dependencies (`server.deps.inline`). Specs and
 * their fixtures keep their built-ins to arrange a scenario, and a package
 * listed in `allowedPackages` keeps its own because the edge platform
 * polyfills it.
 *
 * @param {string[]} allowedPackages
 * @returns {import("vite").Plugin}
 */
function rejectNodeBuiltins(allowedPackages) {
  return {
    name: "edge-reject-node-builtins",
    enforce: "post",
    transform(code, id) {
      if (TEST_FILE.test(id) || id.includes("\0")) return null;
      if (allowedPackages.some((name) => id.includes(`/node_modules/${name}/`))) return null;
      const match = BUILTIN_IMPORT.exec(code);
      if (match) {
        throw new Error(
          `Node built-in "${match[1]}" imported by ${id}, which must run on the edge`,
        );
      }
      return null;
    },
  };
}

/**
 * A Vitest project that runs specs inside Vercel's `edge-runtime` VM (the
 * `@edge-runtime/vm` devDependency), whose globals are the WinterTC minimum
 * set: no DOM, no `Buffer`, no Node built-ins. A spec that passes there also
 * works on any runtime offering that subset, Cloudflare Workers included.
 *
 * It runs the `edgeSpecs` and, in `include`, a package's canonical specs that
 * must also pass there. Dependencies resolve with the `browser` condition, as
 * Wrangler and Next bundle for the edge, so a dependency that only works with a
 * DOM (Lit's browser build, for one) fails to load here instead of resolving to
 * its Node build, which would hide it. Add it as the last entry of a config's
 * `projects`:
 *
 *   projects: [..., edgeProject({ include: ["src/jwt.test.ts"] })]
 *
 * Every project resolves with `workerd`, the condition Wrangler adds for
 * Cloudflare Workers, and `conditions` are extra ones for a package that
 * needs more (`packages/AGENTS.md`); `alias`
 * is the package's own `resolve.alias`; `plugins` are its own Vite plugins,
 * which go here rather than over the result, or the built-in check is lost. A Node built-in imported by anything
 * but a spec or its fixtures fails the run, unless the importing dependency
 * is in `polyfilledPackages` (Nitro polyfills it on the edge).
 *
 * Throws when `include` matches no file in the working directory.
 *
 * @param {import("./vitest.shared.d.mts").EdgeProjectOptions} options
 * @returns {import("./vitest.shared.d.mts").EdgeProject}
 */
export function edgeProject({
  include = [],
  exclude = [],
  conditions = [],
  alias = {},
  polyfilledPackages = [],
  plugins = [],
}) {
  // A pattern that matches nothing would leave the project running no spec
  // and every run green, so fail when the config loads instead.
  const specs = [edgeSpecs, ...include];
  if (globSync(specs, { cwd: process.cwd() }).length === 0) {
    throw new Error(`edgeProject: no spec matches ${specs.join(", ")} in ${process.cwd()}`);
  }
  const resolved = ["workerd", ...conditions];
  return {
    cacheDir: ".vitest/edge",
    plugins: [...plugins, rejectNodeBuiltins(polyfilledPackages)],
    resolve: { conditions: resolved, alias },
    ssr: { resolve: { conditions: ["browser", ...resolved] } },
    test: {
      name: "edge",
      globals: true,
      environment: "edge-runtime",
      include: specs,
      exclude,
      server: { deps: { inline: true } },
    },
  };
}
