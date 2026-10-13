import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/api",
    environment: "node",
    // scripts/inline-openapi.ts feeds orval (orval.config.ts) and is tested
    // beside it.
    include: [...baseTest.include, "scripts/**/*.spec.ts"],
  },
});
