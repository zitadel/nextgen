import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const consoleDir = resolve(workspaceRoot, "apps", "console");

// Runs a package's CLI under this node rather than through its package script:
// a script would hide a step from Moon's task graph, `node --run` does not pass
// the runner's SIGTERM on, and the `.bin` shims are `.cmd` files on Windows.
const nodeCli = (cli: string, ...args: string[]) =>
  [process.execPath, cli, ...args].map((arg) => JSON.stringify(arg)).join(" ");

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
    // The console's `preview` script. The build it serves is the e2e task's
    // `console:build` dep, so it is not rebuilt here.
    command: nodeCli(
      resolve(consoleDir, "node_modules", "vite", "bin", "vite.js"),
      "preview",
      "--host",
      "0.0.0.0",
    ),
    url: "http://localhost:4173",
    reuseExistingServer: true,
    cwd: consoleDir,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
