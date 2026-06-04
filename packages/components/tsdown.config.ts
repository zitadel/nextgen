import { readFileSync } from "node:fs";

import { defineConfig, type Plugin } from "tsdown";

/**
 * Rolldown plugin that turns `.liquid` files into default-exported strings.
 * Mirrors what Vite does natively so `import tpl from "./file.liquid"` works
 * in both dev (Vite) and production (tsdown/rolldown) builds.
 */
function liquidRaw(): Plugin {
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
  plugins: [liquidRaw()],
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
    /^@zitadel-nextgen\/api(\/|$)/,
    /^@zitadel-nextgen\/design-tokens(\/|$)/,
    /^@zitadel-nextgen\/shared-component-styles(\/|$)/,
  ],
});
