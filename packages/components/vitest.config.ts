import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { liquidRaw } from "./vite-liquid-plugin.js";

/** Shared plugins for all vitest projects. */
const sharedPlugins = () => [liquidRaw()];

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
  plugins: sharedPlugins(),
  resolve: { conditions: ["@zitadel/source"] },
  test: {
    name: "@zitadel/components",
    watch: false,
    coverage: {
      reportsDirectory: "./test-output/vitest/coverage",
      provider: "v8",
      include: ["src/**/*.ts"],
    },
    projects: [
      {
        plugins: sharedPlugins(),
        resolve: { conditions: ["@zitadel/source"] },
        test: {
          name: "unit",
          globals: true,
          environment: "jsdom",
          // jsdom 29 lacks `crypto.subtle`; the setup file backs it with
          // Node's WebCrypto for the captcha-gate solve/mint paths.
          setupFiles: ["./vitest.setup.unit.ts"],
          include: ["src/**/*.spec.ts"],
          exclude: ["src/**/*.browser.spec.ts"],
        },
      },
      {
        plugins: sharedPlugins(),
        resolve: { conditions: ["@zitadel/source"] },
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
