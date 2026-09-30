import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/testing (integration)",
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Distinct report file so a local `test` + `test-integration` run does not
    // clobber the unit lane's junit output.
    reporters: [
      "default",
      ["junit", { outputFile: "./test-output/vitest/junit.integration.xml" }],
    ],
    // A cold boot (initdb + migrations) takes ~20-30s; budget generously.
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
