import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

/**
 * Unit tests for the lane's own code: reading the spec and Schemathesis's
 * report. They need neither a server nor Docker, so they run with the rest of
 * the e2e project's unit tests; the contract run is `vitest.config.ts`.
 */
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/e2e-api-contract-unit",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/contract.test.ts"],
    coverage: { ...baseTest.coverage, include: ["src/**/*.ts"] },
  },
});
