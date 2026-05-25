import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Two test projects:
 *
 * - `unit` — runs in jsdom. Fast feedback for the bulk of the suite. Skips
 *   the form-associated custom-element checks because jsdom 29 only ships a
 *   partial implementation.
 * - `browser` — runs in real Chromium via Playwright. Owns the
 *   `*.browser.spec.ts` files: form participation, Enter-to-submit, focus
 *   management, and other behaviours that require a real platform.
 *
 * `pnpm test` runs the unit project (the default in CI / pre-commit).
 * `pnpm test:browser` runs the browser project. `pnpm test:all` runs both.
 */
export default defineConfig({
  plugins: [nxViteTsPaths()],
  resolve: { conditions: ["@zitadel-nextgen/source"] },
  test: {
    name: "@zitadel-nextgen/components",
    watch: false,
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
    projects: [
      {
        test: {
          name: "unit",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.spec.ts"],
          exclude: ["src/**/*.browser.spec.ts"],
        },
      },
      {
        test: {
          name: "browser",
          globals: true,
          include: ["src/**/*.browser.spec.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
