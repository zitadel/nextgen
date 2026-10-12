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
  "@zitadel/api",
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
