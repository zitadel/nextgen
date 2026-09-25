import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { withZitadel } from "@zitadel/testing/playwright";

/**
 * Screen recordings of the embedded console (#1300): `moon run
 * console-e2e:record-screens`.
 *
 * The deployment a customer runs: the built binary serving the console and
 * the API at one origin with the platform project bootstrapped, no Vite proxy
 * and no project secret in any console request. The output is a video per
 * scenario plus a still per step, not a verdict: the specs visit the
 * management screens at a readable pace and never fail on what they find — an
 * error state on screen *is* the result a reviewer wants to see.
 *
 * Recordings land in `recordings/`, named by `RECORD_SCREENS_LABEL` (e.g.
 * `before` / `after`) so a PR can show two builds side by side; point
 * `ZITADEL_SERVER_BINARY` at another build to record it.
 */
const appDir = import.meta.dirname;
const workspaceRoot = join(appDir, "../..");
// Neighbors: 8092 demo-next-e2e e2e-real, 8093 console-e2e e2e-real,
// 8094 console dev-real, 8095 console-e2e e2e-embedded.
const zitadelPort = Number(process.env.RECORD_SCREENS_ZITADEL_PORT ?? 8096);
const origin = `http://localhost:${zitadelPort}`;
const viewport = { width: 1280, height: 800 };

export default defineConfig({
  testDir: "./src-recording",
  // One video at a time, in order: the recordings are the product.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 5 * 60_000,
  outputDir: "test-results/record-screens",
  reporter: [["list"]],
  use: {
    baseURL: `${origin}/ui/console/`,
    viewport,
    video: { mode: "on", size: viewport },
    launchOptions: { slowMo: 250 },
    // A step that cannot be driven is skipped, not waited on for the whole
    // test timeout (Playwright's action default is no timeout at all).
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  expect: { timeout: 10_000 },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    appOrigin: origin,
    handshakePath: join(appDir, ".zitadel-testing", "handshake-record-screens.json"),
    zitadel: {
      serverBinary:
        process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
      serverBinaryHint: "run `moon run server:build` first.",
    },
  }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport },
    },
  ],
});
