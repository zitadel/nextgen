import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { baseTest, sourceConditions } from "../../vitest.shared.mjs";

/**
 * Browser lane (real Chromium via Playwright). Run via `test:browser`, kept in
 * its own config so the project selection and its distinct junit output live in
 * config rather than as CLI flags. Smoke-tests the `setupMock(worker)` browser
 * entry against `msw/browser`. Requires a Playwright browser install; not in CI.
 */
export default defineConfig({
  resolve: { conditions: sourceConditions },
  test: {
    ...baseTest,
    name: "@zitadel/api-mock (browser)",
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
