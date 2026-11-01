import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

export default defineConfig({
  cacheDir: ".vitest",
  // tsconfig.json's `@/*`, which Next resolves itself.
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    ...baseTest,
    name: "@zitadel/cloud-functions",
    environment: "node",
    include: ["src/**/*.spec.ts"],
    coverage: { ...baseTest.coverage, include: ["src/**/*.ts"] },
  },
});
