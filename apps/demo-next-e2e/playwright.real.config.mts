import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

/**
 * Real-instance variant of the embedded sign-in e2e:
 *
 *   webServer[0] boots an ephemeral seeded Zitadel (@zitadel/testing) and
 *   writes a handshake file; webServer[1] waits for it and starts demo-next
 *   with that instance's project env. Tests mint their own users per test via
 *   the @zitadel/testing/playwright fixtures, so they run fully parallel on
 *   the one shared instance.
 *
 * The api-mock suite in playwright.config.mts stays the fast default; this
 * config is the fidelity check against the real server.
 */
const appDir = import.meta.dirname;
const handshakePath = join(appDir, ".zitadel-testing", "handshake.json");
const zitadelPort = Number(process.env.REAL_ZITADEL_PORT ?? 8092);

// Workers inherit the runner's env; the fixtures resolve the instance from it.
process.env.ZITADEL_TESTING_HANDSHAKE = handshakePath;

export default defineConfig({
  testDir: "./src-real",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://localhost:3002",
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
      // Cold boot (initdb + migrations) takes ~20-30s.
      timeout: 120_000,
      env: {
        REAL_ZITADEL_PORT: String(zitadelPort),
        ZITADEL_TESTING_HANDSHAKE: handshakePath,
      },
      // SIGTERM first so the wrapper can stop the instance and reap embedded
      // Postgres; the default hard kill would orphan the postmaster.
      gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    },
    {
      command: "node scripts/dev-with-real-env.mts",
      url: "http://localhost:3002/login",
      reuseExistingServer: false,
      cwd: appDir,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180_000,
      env: {
        ZITADEL_TESTING_HANDSHAKE: handshakePath,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
