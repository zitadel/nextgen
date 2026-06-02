import { defineConfig } from "tsdown";

/**
 * Library build for `@zitadel/components`.
 *
 * Each subpath in `package.json` `exports` has its own entry so consumers can
 * `import { ... } from "@zitadel/components/atoms"` without dragging
 * in the orchestrator (and its `liquidjs` + `dompurify` dependencies).
 *
 * Public `@zitadel/*` workspace packages (`api-client`, `design-tokens`,
 * `shared-component-styles`) are inlined into the dist chunks so published
 * subpaths do not leak workspace-only CSS or source imports.
 * `@zitadel-nextgen/api-mock` stays external because it's a test-only helper
 * consumers never import.
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
  // `clean: true` would wipe the .d.ts files tsgo emits during the
  // `typecheck` target, breaking project-reference consumers
  // (sdk-next, demo-next, demo-nuxt) whose tsgo --build expects those
  // .d.ts files to exist. tsdown still overwrites its own .mjs/.d.mts
  // outputs on each rebuild — stale files just accumulate harmlessly
  // until a full `git clean` or `nx reset`.
  clean: false,
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
    /^@zitadel\/api-client(\/|$)/,
    /^@zitadel\/design-tokens(\/|$)/,
    /^@zitadel\/shared-component-styles(\/|$)/,
  ],
});
