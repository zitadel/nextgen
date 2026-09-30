import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/cli",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Build the oclif dist the integration suite drives before any test runs,
    // so `vitest run` is self-contained (package-local setup, no cross-package
    // coupling). This also keeps the built CLI fresh rather than depending on a
    // possibly-stale cached build.
    globalSetup: ["tests/helpers/global-setup.ts"],
  },
});
