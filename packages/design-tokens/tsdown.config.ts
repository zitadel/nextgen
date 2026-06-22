import { defineConfig } from "tsdown";

/**
 * Library build for `@zitadel/design-tokens`.
 *
 * Only the typed TypeScript surface ships through tsdown:
 *   `import { tokens } from "@zitadel/design-tokens"`
 *
 * The CSS surfaces (`./css/tokens.css`, `./css/tailwind.css`) are plain
 * stylesheets emitted by Style Dictionary and served straight out of
 * `src/generated/` via the package `exports` map — they never need bundling
 * and consumers' bundlers (Vite, Next, esbuild) load them as-is.
 */
export default defineConfig({
  entry: {
    tokens: "src/generated/tokens.ts",
  },
  outDir: "dist",
  format: ["esm"],
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
