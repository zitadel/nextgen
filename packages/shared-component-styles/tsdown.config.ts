import { defineConfig } from "tsdown";

/**
 * Library build for `@zitadel-nextgen/shared-component-styles`.
 *
 * Only the typed attribution markup ships through tsdown. CSS surfaces are plain
 * stylesheets served from `src/` via the package `exports` map.
 */
export default defineConfig({
  entry: {
    "attribution-markup": "src/attribution-markup.ts",
  },
  outDir: "dist",
  format: ["esm"],
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
