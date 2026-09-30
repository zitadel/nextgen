import { resolve } from "node:path";

import { defineConfig } from "vite";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/packages/sdk-core",
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
    ...baseTest,
    name: "@zitadel/sdk-core",
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
