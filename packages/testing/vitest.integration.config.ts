import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    environment: "node",
    // Distinct report file so a local `test` + `test-integration` run does not
    // clobber the unit lane's junit output. Reporters inherit from baseTest.
    outputFile: { junit: "./test-output/vitest/junit.integration.xml" },
    // A cold boot (initdb + migrations) takes ~20-30s; budget generously.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    projects: [
      {
        extends: true,
        test: {
          name: "@zitadel/testing (integration)",
          include: ["tests/integration/*.test.ts"],
        },
      },
      {
        // The `./vitest` entry end to end: its global setup boots the run's
        // instance, so it gets a project of its own.
        extends: true,
        test: {
          name: "@zitadel/testing (integration: vitest entry)",
          include: ["tests/integration/vitest-entry/**/*.test.ts"],
          globalSetup: ["./tests/integration/vitest-entry/global-setup.ts"],
        },
      },
    ],
  },
});
