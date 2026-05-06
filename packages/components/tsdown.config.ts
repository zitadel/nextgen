import { defineConfig } from "tsdown";

/**
 * Library build for `@zitadel-nextgen/components`.
 *
 * Each subpath in `package.json` `exports` has its own entry so consumers can
 * `import { ... } from "@zitadel-nextgen/components/atoms"` without dragging
 * in the orchestrator (and its `liquidjs` + `dompurify` dependencies).
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "atoms/index": "src/atoms/index.ts",
    manifests: "src/manifests.ts",
    "tokens/index": "src/tokens/index.ts",
    "orchestrator/index": "src/orchestrator/index.ts",
    "orchestrator/transport": "src/orchestrator/transport.ts",
  },
  outDir: "dist",
  format: ["esm"],
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["lit", /^lit\//, "liquidjs", "dompurify"],
});
