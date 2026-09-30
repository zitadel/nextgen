import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    ...baseTest,
    name: "@zitadel/cli",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The oclif dist the integration suite drives is built by the moon `build`
    // dep of cli:test; the shared root global setup is inherited from baseTest.
  },
});
