import { defineConfig } from "tsdown";

/**
 * Library build for `@zitadel-nextgen/components`.
 *
 * Each subpath in `package.json` `exports` has its own entry so consumers can
 * `import { ... } from "@zitadel-nextgen/components/atoms"` without dragging
 * in the orchestrator (and its `liquidjs` + `dompurify` dependencies).
 *
 * Internal `@zitadel-nextgen/*` workspace packages (`api`, `design-tokens`,
 * `shared-component-styles`) are inlined into the dist so consumers only
 * need to install `@zitadel-nextgen/components` itself — no transitive
 * registry deps. `@zitadel-nextgen/api-mock` stays external because it's a
 * test-only helper consumers never import.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "atoms/index": "src/atoms/index.ts",
    manifests: "src/manifests.ts",
    "tokens/index": "src/tokens/index.ts",
    "orchestrator/index": "src/orchestrator/index.ts",
  },
  outDir: "dist",
  format: ["esm"],
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: [
    "lit",
    /^lit\//,
    "liquidjs",
    "dompurify",
    "lucide",
    /^lucide\//,
    "@zitadel-nextgen/api-mock",
  ],
  /** Inline internal workspace deps so the published package is self-contained. */
  noExternal: [
    /^@zitadel-nextgen\/api(\/|$)/,
    /^@zitadel-nextgen\/design-tokens(\/|$)/,
    /^@zitadel-nextgen\/shared-component-styles(\/|$)/,
  ],
});
