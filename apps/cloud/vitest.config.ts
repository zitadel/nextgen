import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/cloud",
    environment: "node",
    coverage: { ...baseTest.coverage, exclude: ["src/**/*.test.ts"] },
  },
});
