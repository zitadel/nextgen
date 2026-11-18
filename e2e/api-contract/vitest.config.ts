import { defineConfig } from "vitest/config";

import { baseTest } from "@zitadel/vitest-config";

/**
 * The API contract lane: Schemathesis, driven through Testcontainers, against
 * a real instance of the server in this working tree. The fixtures boot the
 * instance and the container and run Schemathesis once; the tests then judge
 * what it found.
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
    include: ["src/api-contract.test.ts"],
    // The first test to ask for a fixture waits for it: booting the instance,
    // starting the container and the whole Schemathesis run happen there.
    hookTimeout: 900_000,
    testTimeout: 900_000,
  },
});
