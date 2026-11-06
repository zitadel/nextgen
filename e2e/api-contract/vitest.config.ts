import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

/**
 * The API contract lane: Schemathesis, driven through Testcontainers, against
 * a real instance of the server in this working tree. `globalSetup` boots the
 * instance and runs Schemathesis once; the suite then holds one test per
 * operation in the spec, each failing with the checks that operation broke.
 */
export default defineConfig({
  // The task runs from the package root (e2e); pin the root to this folder so
  // the globs below resolve against api-contract/, not e2e/.
  root: import.meta.dirname,
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/e2e-api-contract",
    environment: "node",
    include: ["src/contract.test.ts"],
    globalSetup: ["./global-setup.ts"],
    // Booting the instance and the whole Schemathesis run happen in globalSetup;
    // the per-operation tests only read its report.
    hookTimeout: 900_000,
    testTimeout: 30_000,
  },
});
