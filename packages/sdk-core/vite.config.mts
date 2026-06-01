import { resolve } from "node:path";

import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/packages/sdk-core",
  plugins: [nxViteTsPaths()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        types: resolve(import.meta.dirname, "src/types.ts"),
        jwt: resolve(import.meta.dirname, "src/jwt.ts"),
        "middleware": resolve(import.meta.dirname, "src/middleware.ts"),
      },
      formats: ["es" as const],
    },
  },
  test: {
    name: "@zitadel-nextgen/sdk-core",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
}));
