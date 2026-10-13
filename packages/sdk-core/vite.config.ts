import { resolve } from "node:path";
// `defineConfig` comes from `vitest/config` (not `vite`) so the `test` field
// typechecks: Vitest 4 no longer augments Vite's own `UserConfig` with `test`.
import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: ".vitest",
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        types: resolve(import.meta.dirname, "src/types.ts"),
        jwt: resolve(import.meta.dirname, "src/jwt.ts"),
        middleware: resolve(import.meta.dirname, "src/middleware.ts"),
      },
      formats: ["es" as const],
    },
  },
  test: {
    ...baseTest,
    name: "@zitadel/sdk-core",
    environment: "node",
  },
});
