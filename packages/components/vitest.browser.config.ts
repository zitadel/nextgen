import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";
import { liquidRaw } from "./vite-liquid-plugin.js";

/**
 * Browser lane (real Chromium via Playwright). Run via `test:browser`, kept in
 * its own config so the project selection and its distinct junit output live in
 * config rather than as CLI flags on the script. Owns the `*.browser.spec.ts`
 * files: form participation, Enter-to-submit, focus management, and other
 * behaviours that need a real platform. Requires a Playwright browser install.
 */
export default defineConfig({
  plugins: [liquidRaw()],
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/components (browser)",
    include: ["src/**/*.browser.spec.ts"],
    // Distinct report so a concurrent unit + browser run in this cwd never
    // clobbers the unit lane's junit.
    outputFile: { junit: "./test-output/vitest/junit.browser.xml" },
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
