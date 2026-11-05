import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    types: "src/types.ts",
    jwt: "src/jwt.ts",
    middleware: "src/middleware.ts",
  },
  outDir: "dist",
  format: ["esm"],
  failOnWarn: true,
  tsconfig: "tsconfig.lib.json",
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  deps: { neverBundle: ["@zitadel/api"] },
});
