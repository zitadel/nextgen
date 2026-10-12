import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

/**
 * Unit tests for this project's own harness scripts (`scripts/*.mjs`): port
 * allocation, tarball verification, runner option parsing, the framework list,
 * and app preparation. The Playwright journey suites under `src/` are a
 * separate runner (`e2e*` tasks) and are not selected here.
 */
export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "@zitadel/cli-journey-e2e",
    environment: "node",
    include: ["scripts/**/*.test.mjs"],
    coverage: { ...baseTest.coverage, include: ["scripts/**/*.mjs"] },
  },
});
