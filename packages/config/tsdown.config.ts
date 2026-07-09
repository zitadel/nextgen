import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    defaults: "src/defaults.ts",
    normalize: "src/normalize.ts",
    schemas: "src/schemas.ts",
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
