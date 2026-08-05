import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    // A cold boot (initdb + migrations) takes ~20-30s; budget generously.
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
