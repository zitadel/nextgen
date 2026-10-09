import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { withZitadel } from "@zitadel/testing/playwright";

/**
 * The embedded console against a deployment with the platform project
 * bootstrapped — the shape the console is built for (#1300).
 *
 * Same server as `playwright.embedded.config.mts` (the built binary serving
 * the console and the API at one origin, no Vite proxy, no project secret in
 * any console request), but with `platform.bootstrap_project` left at the
 * server default instead of switched off: the console signs people into the
 * platform project, and customer projects are managed through grants. That
 * is what the embedded lane cannot show, because its sign-ins run against the
 * harness's own project.
 *
 * No `app` entry: the instance is the app server (see `withZitadel`).
 */
const appDir = import.meta.dirname;
const workspaceRoot = join(appDir, "../..");
// A fixed pin, same reasoning as the embedded lane. Neighbors: 8093
// console-e2e e2e-real, 8094 console dev-real, 8095 console-e2e e2e-embedded.
const zitadelPort = Number(process.env.PLATFORM_ZITADEL_PORT ?? 8097);
const origin = `http://localhost:${zitadelPort}`;

export default defineConfig({
  testDir: "./src-platform",
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results/platform",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/platform" }]],
  use: {
    baseURL: origin,
    trace: "on-first-retry",
  },
  // Sign-up plus a walk over every screen: readiness, not latency, is under
  // test, so give the visibility assertions the embedded lane's headroom.
  expect: { timeout: 10_000 },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    appOrigin: origin,
    // Own handshake file, so this lane can run next to the others.
    handshakePath: join(appDir, ".zitadel-testing", "handshake-platform.json"),
    zitadel: {
      serverBinary:
        process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
      serverBinaryHint: "run `moon run server:build` first.",
    },
  }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
