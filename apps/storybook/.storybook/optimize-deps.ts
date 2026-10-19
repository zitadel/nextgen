import apiPackage from "@zitadel/api/package.json" with { type: "json" };

/**
 * Shared Vite dep-optimizer config for both the Storybook server
 * (`.storybook/main.ts`) and the `@storybook/addon-vitest` browser run
 * (`vitest.config.ts`).
 *
 * The workspace packages register custom elements as a side effect and ship
 * raw TS source (api-mock), so they're excluded to keep a single module
 * instance and let Vite transpile them through the main pipeline. Their heavy
 * third-party deps are pre-bundled instead — otherwise the Vitest browser run
 * discovers them behind the excluded packages mid-test and reloads, which
 * loses the current suite and fails the import.
 *
 * Every `optimizeDepsInclude` entry must be resolvable from this app, so the
 * transitive deps of the excluded workspace packages (`dompurify`, `liquidjs`,
 * `lucide`, `xstate`, `@faker-js/faker`) are declared as
 * devDependencies in `apps/storybook/package.json`. Under pnpm's strict
 * node_modules they are otherwise unresolvable from here on a clean install, so
 * Vite cannot pre-bundle them and falls back to the mid-test reload above —
 * which passes on a warm local cache but fails every cold CI run.
 */
export const optimizeDepsExclude = [
  "@zitadel/components",
  "@zitadel/design-tokens",
  "@zitadel/api-mock",
];

export const optimizeDepsInclude = [
  "lit",
  "lit/decorators.js",
  "lit/directive-helpers.js",
  "lit/directives/class-map.js",
  "lit/directives/if-defined.js",
  "lit/directives/keyed.js",
  "lit/directives/live.js",
  "lit/directives/unsafe-html.js",
  "lit/directives/unsafe-svg.js",
  // Imported by `.storybook/preview.ts`, which the Vitest addon loads as its
  // setup file. Un-prebundled, the browser discovers it mid-setup and Vite
  // re-optimizes, invalidating the in-flight setup-file URL — the "Failed to
  // fetch dynamically imported module" that fails cold CI runs of the story
  // tests (passes on a warm local cache, same as the excluded-dep case above).
  "msw-storybook-addon",
  "dompurify",
  "liquidjs",
  "lucide",
  "lucide-react",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "xstate",
  "@faker-js/faker",
];

/**
 * The generated `@zitadel/api` client, pre-bundled for the Vitest browser run
 * only. From source it is ~1,260 modules, one per generated model type, and
 * every story file runs in a fresh iframe that loads all of them again.
 * Pre-bundled, it is a handful of files.
 *
 * Every subpath the package exports is listed, so whichever one a story, an atom
 * or the mock imports comes from the same bundle. A subpath loaded from source
 * would bring a second copy of the client's module state: the proxy path
 * `configureZitadel` sets, the `ApiError` class the orchestrator checks for.
 *
 * Vite keys its pre-bundle cache on the lockfile and config, not on the files of
 * a linked workspace package, so a cached bundle goes stale after
 * `api:generate`. The Storybook server therefore keeps loading the client from
 * source (Vite pre-bundles a linked package only when it is listed), and the
 * Vitest run re-bundles on every start (`optimizeDeps.force`).
 */
export const apiClientInclude = Object.keys(apiPackage.exports)
  .filter((subpath) => subpath !== "./package.json")
  .map((subpath) => `@zitadel/api${subpath.slice(1)}`);
