import { defineConfig } from "vitest/config";

import { baseTest } from "../../vitest.shared.mjs";

export default defineConfig({
  cacheDir: ".vitest",
  test: {
    ...baseTest,
    name: "vite-plugin-nuxt-module",
    environment: "node",
    include: ["src/**/*.test.ts", "tests/*.test.ts"],
    // Most specs run a real Vite build and a TypeScript program over a fixture package.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
