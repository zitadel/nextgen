import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import {
  e2eActionTimeouts,
  e2eTimeouts,
  fastChromiumLaunchOptions,
} from "@zitadel/testing/playwright";

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
  ...e2eTimeouts,
  testDir: "./src",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    ...e2eActionTimeouts,
    baseURL: "http://localhost:4173",
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },
  /* Run your local dev server before starting the tests */
  webServer: {
    // Preview only — the console dist is already built by the `console:build`
    // moon dependency. Building again here would rewrite the dist that the
    // real/embedded lanes' server:build embeds, racing those writers.
    command: "corepack pnpm --filter @zitadel/console run preview",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: fastChromiumLaunchOptions },
    },
  ],
});
