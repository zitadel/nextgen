import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/testing",
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
