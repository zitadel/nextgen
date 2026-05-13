import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@zitadel-nextgen/api",
    watch: false,
    passWithNoTests: true,
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
