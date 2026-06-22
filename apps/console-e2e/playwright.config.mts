import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./src",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: "http://localhost:4173",
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },
  /* Run your local dev server before starting the tests */
  webServer: {
    command: "corepack pnpm --filter @zitadel/console run build && corepack pnpm --filter @zitadel/console run preview",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
