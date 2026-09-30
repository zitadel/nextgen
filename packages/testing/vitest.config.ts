import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/testing",
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
