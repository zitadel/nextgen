import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

/**
 * The contract spec: builds a fixture Nuxt module with the plugin, installs it into a Nuxt app and
 * starts that app. Slow, so it is its own config (`pnpm run test:contract`) and outside `test`.
 */
export default defineConfig({
  cacheDir: ".vitest/contract",
  test: {
    ...baseTest,
    name: "vite-plugin-nuxt-module:contract",
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    exclude: ["tests/contract/fixtures/**"],
    // One Nuxt build and server at a time.
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 600_000,
    outputFile: { junit: "./test-output/vitest-contract/junit.xml" },
  },
});
