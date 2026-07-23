import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Real-instance console coverage:
 *
 *   webServer[0] boots and bootstraps an ephemeral Zitadel instance;
 *   webServer[1] maps its handle to the console's Vite proxy environment.
 *
 * The existing config remains the production embed-base smoke test. This
 * config exercises live resource pages through the server-side dev proxy.
 */
const appDir = import.meta.dirname;
const handshakePath = join(appDir, ".zitadel-testing", "handshake.json");
const zitadelPort = Number(process.env.REAL_ZITADEL_PORT ?? 8093);
const consoleOrigin = process.env.REAL_CONSOLE_ORIGIN ?? "http://localhost:5174";

// Workers inherit the runner's env; @zitadel/testing fixtures read this path.
process.env.ZITADEL_TESTING_HANDSHAKE = handshakePath;

export default defineConfig({
  testDir: "./src-real",
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results/real",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/real" }]],
  use: {
    baseURL: consoleOrigin,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "node scripts/real-zitadel.mts",
      url: `http://localhost:${zitadelPort}/healthz`,
      reuseExistingServer: false,
      cwd: appDir,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
      env: {
        REAL_APP_ORIGIN: consoleOrigin,
        REAL_ZITADEL_PORT: String(zitadelPort),
        ZITADEL_TESTING_HANDSHAKE: handshakePath,
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    },
    {
      command: "node scripts/dev-with-real-env.mts",
      url: `${consoleOrigin}/projects`,
      reuseExistingServer: false,
      cwd: appDir,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180_000,
      env: {
        ZITADEL_TESTING_HANDSHAKE: handshakePath,
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
