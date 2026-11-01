import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "@zitadel/vitest-config";

export default defineConfig({
  cacheDir: ".vitest",
  // tsconfig.json's `@/*`, which Next resolves itself, and @zitadel/api from
  // its source, as tsc reads it.
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
    conditions: sourceConditions,
  },
  test: {
    ...baseTest,
    name: "@zitadel/cloud-functions",
    environment: "node",
    include: ["src/**/*.spec.ts"],
    coverage: { ...baseTest.coverage, include: ["src/**/*.ts"] },
  },
});
