import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@zitadel-nextgen/cli",
    watch: false,
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
