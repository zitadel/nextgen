import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@zitadel-nextgen/api",
    watch: false,
    passWithNoTests: true,
    globals: true,
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          args: ["--remote-debugging-port=9222"],
        },
      }),
      instances: [{ browser: "chromium" }],
    },
    include: ["src/**/*.spec.ts"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
