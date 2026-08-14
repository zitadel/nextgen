import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "branding-url": "src/branding-url.ts",
    index: "src/index.ts",
    defaults: "src/defaults.ts",
    "meta-schemas": "src/meta-schemas.ts",
    normalize: "src/normalize.ts",
    schemas: "src/schemas.ts",
    template: "src/template.ts",
    validate: "src/validate.ts",
  },
  outDir: "dist",
  format: ["esm"],
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["@zitadel/api"],
});
