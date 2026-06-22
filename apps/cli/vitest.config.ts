import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@zitadel/cli",
    watch: false,
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
