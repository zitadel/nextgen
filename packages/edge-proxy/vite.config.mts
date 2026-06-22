import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/packages/edge-proxy",
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
      },
      formats: ["es" as const],
    },
  },
  test: {
    name: "@zitadel/edge-proxy",
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
