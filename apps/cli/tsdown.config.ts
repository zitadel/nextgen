import { defineConfig } from "tsdown";

/**
 * Single-entry build for oclif's explicit command strategy: `src/index.ts`
 * exports the `COMMANDS` table (hand-written commands plus the ones built
 * from the resource registry) and oclif loads `dist/index.mjs` at runtime.
 * The root help class is built alongside it for `oclif.helpClass`.
 * `@oclif/*` (core + plugins) stays external — resolved from node_modules at
 * runtime, never bundled — which is what lets the plugin system work.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "lib/oclif/help": "src/lib/oclif/help.ts",
  },
  outDir: "dist",
  tsconfig: "tsconfig.app.json",
  format: ["esm"],
  failOnWarn: true,
  dts: false,
  sourcemap: true,
  clean: true,
  shims: true,
  deps: { neverBundle: [/^@oclif\//] },
  target: false,
});
