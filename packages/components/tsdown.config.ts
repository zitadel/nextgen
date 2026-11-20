import { readFileSync } from "node:fs";

import { defineConfig, type TsdownPlugin, type UserConfig } from "tsdown";

/**
 * Rolldown plugin that turns `.liquid` files into default-exported strings.
 * Mirrors what Vite does natively so `import tpl from "./file.liquid"` works
 * in both dev (Vite) and production (tsdown/rolldown) builds.
 */
function liquidRaw(): TsdownPlugin {
  return {
    name: "liquid-raw",
    load(id) {
      if (!id.endsWith(".liquid")) return null;
      const content = readFileSync(id, "utf-8");
      return `export default ${JSON.stringify(content)};`;
    },
  };
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

/**
 * Standalone build — one self-contained file for a plain HTML page. Here the
 * third-party UI deps ARE inlined, so `<script type="module"
 * src="…/standalone.mjs">` works with no import map and no bundler. Kept
 * separate from the library build so npm/SDK consumers are unaffected.
 *
 * One config per file: entries that share a config share chunks, and a chunk
 * import is what a standalone file must not have.
 *
 * `platform: "browser"` is required: the default ("node") makes rolldown emit
 * `import { createRequire } from "node:module"` for its CJS-interop helper,
 * which a browser cannot resolve — the whole module then fails to load. The
 * browser platform also picks the `browser`/`import` export conditions of the
 * inlined deps so no Node-only entry points leak in.
 */
function standalone(name: string, source: string): UserConfig {
  return {
    plugins: [liquidRaw()],
    entry: { [name]: source },
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
    // The library build above cleans dist; a standalone file is appended.
    clean: false,
    target: "es2022",
    deps: {
      neverBundle: ["@zitadel/api-mock"],
      alwaysBundle: [...INLINE_INTERNAL, ...INLINE_STANDALONE_ONLY, ...THIRD_PARTY],
    },
  };
}

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
    // The first entry cleans dist; the standalone entries below keep
    // `clean: false` so they append to it instead of wiping this one.
    clean: true,
    target: "es2022",
    deps: {
      neverBundle: [...THIRD_PARTY, "@zitadel/api-mock"],
      alwaysBundle: INLINE_INTERNAL,
    },
  },

  standalone("standalone", "src/index.ts"),
  // `<zl-passkey>` alone, for a page that renders its own form: the Go login
  // SDK embeds this file (packages/go/login).
  standalone("passkey-standalone", "src/passkey-standalone.ts"),
]);
