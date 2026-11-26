import { defineConfig, type TsdownPlugin } from "tsdown";

import { liquidRaw as sharedLiquidRaw } from "./vite-liquid-plugin.ts";

/**
 * The shared `.liquid` plugin (raw strings and `?compiled` render
 * functions), the same one Vite uses in tests and Storybook.
 *
 * @returns The plugin, typed for Rolldown.
 */
function liquidRaw(): TsdownPlugin {
  return sharedLiquidRaw() as TsdownPlugin;
}

/**
 * Library build for `@zitadel/components`.
 *
 * Each subpath in `package.json` `exports` has its own entry so consumers can
 * `import { ... } from "@zitadel/components/atoms"` without dragging
 * in the orchestrator (and its `liquidjs` + `dompurify` dependencies).
 *
 * Internal `@zitadel/*` workspace packages (`api`, `design-tokens`) are inlined
 * into the dist so consumers only need to install `@zitadel/components` itself
 * — no transitive registry deps. `@zitadel/api-mock` stays external because
 * it's a test-only helper consumers never import.
 */
/** Internal workspace deps are always inlined so the published package is self-contained. */
const INLINE_INTERNAL = [/^@zitadel\/api(\/|$)/, /^@zitadel\/design-tokens(\/|$)/];

/**
 * Published workspace deps that stay EXTERNAL in the library build (declared
 * runtime dependencies npm resolves — `@zitadel/config` provides the shared
 * template contract) but MUST be inlined into the standalone file: a browser
 * cannot resolve a bare package specifier, so leaving them external would
 * break the unpkg/jsDelivr entry at load time.
 */
const INLINE_STANDALONE_ONLY = [/^@zitadel\/config(\/|$)/];

/** Third-party runtime deps the components need in the browser. */
const THIRD_PARTY = ["lit", /^lit\//, "liquidjs", "dompurify", "lucide", /^lucide\//] as const;

export default defineConfig([
  /**
   * Library build — the npm entrypoints. `lit`/`liquidjs`/`dompurify`/`lucide`
   * stay EXTERNAL so a consuming app's bundler resolves a single shared copy
   * (no duplicate-Lit). This is what `import "@zitadel/components"` resolves to.
   */
  {
    plugins: [liquidRaw()],
    entry: {
      index: "src/index.ts",
      // Resolved instead of `index` under the edge export conditions (see
      // package.json); it must never import Lit.
      server: "src/server.ts",
      "atoms/index": "src/atoms/index.ts",
      manifests: "src/manifests.ts",
      events: "src/events.ts",
      // Lit-free, so the console can share the avatar without the atoms.
      avatar: "src/avatar.ts",
      "tokens/index": "src/tokens/index.ts",
      "orchestrator/index": "src/orchestrator/index.ts",
      // Not a public subpath. As its own entry it stays a separate file that
      // the entries import ahead of the chunks that load `lit`; inlined, it
      // would land below the hoisted `import "lit"` and run too late (see
      // src/internal/lit-dev-mode.ts).
      "internal/lit-dev-mode": "src/internal/lit-dev-mode.ts",
    },
    outDir: "dist",
    format: ["esm"],
    failOnWarn: true,
    tsconfig: "tsconfig.lib.json",
    dts: true,
    sourcemap: true,
    // Shipped React JSX declarations (`exports["./jsx"]`). Copied verbatim
    // into the outDir: the file is a hand-authored ambient
    // `declare module "react"` block, which the dts bundler must not process
    // (see src/jsx.d.ts).
    copy: [
      "src/jsx.d.ts",
      // `./avatar.css`: the console paints its avatar with the atom's rules.
      "src/styles/avatar.css",
      // The retired split/hero designs (#1039), exported as
      // `./legacy-designs/*` for Storybook, which shows them for review.
      { from: "src/orchestrator/__fixtures__/legacy-designs", to: "dist" },
    ],
    // The first entry cleans dist; the standalone entry below keeps
    // `clean: false` so it appends standalone.mjs instead of wiping this one.
    clean: true,
    target: "es2022",
    deps: {
      neverBundle: [...THIRD_PARTY, "@zitadel/api-mock"],
      alwaysBundle: INLINE_INTERNAL,
    },
  },

  /**
   * Standalone build — one self-contained file for a plain HTML page. Here the
   * third-party UI deps ARE inlined, so `<script type="module"
   * src="…/standalone.mjs">` works with no import map and no bundler. Kept
   * separate from the library build above so npm/SDK consumers are unaffected.
   *
   * `platform: "browser"` is required: the default ("node") makes rolldown emit
   * `import { createRequire } from "node:module"` for its CJS-interop helper,
   * which a browser cannot resolve — the whole module then fails to load. The
   * browser platform also picks the `browser`/`import` export conditions of the
   * inlined deps so no Node-only entry points leak in.
   */
  {
    plugins: [liquidRaw()],
    entry: { standalone: "src/index.ts" },
    outDir: "dist",
    format: ["esm"],
    failOnWarn: true,
    platform: "browser",
    // `platform: "browser"` would otherwise emit `standalone.js`; force `.mjs`
    // so the `unpkg`/`jsdelivr`/`./standalone` paths in package.json still match.
    fixedExtension: true,
    tsconfig: "tsconfig.lib.json",
    dts: false,
    sourcemap: false,
    // Nothing minifies this file after us: it is loaded as is from a CDN.
    minify: true,
    // One file: the Liquid engine, which the library build loads with a
    // dynamic import, is inlined here rather than left as a second chunk.
    outputOptions: { codeSplitting: false },
    clean: false,
    target: "es2022",
    deps: {
      neverBundle: ["@zitadel/api-mock"],
      alwaysBundle: [...INLINE_INTERNAL, ...INLINE_STANDALONE_ONLY, ...THIRD_PARTY],
    },
  },
]);
