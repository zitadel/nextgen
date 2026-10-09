import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { withZitadel } from "@zitadel/testing/playwright";

/**
 * The embedded surfaces, served the way a customer gets them.
 *
 * The other two console suites both serve the console themselves and are
 * blind to how the Go binary does it:
 *
 *   - `playwright.config.mts` runs `vite preview` with no backend at all, so
 *     every API call fails identically whatever base it targeted;
 *   - `playwright.real.config.mts` runs the Vite dev server, whose proxy
 *     rewrites `/api/*` to the API root — precisely the layer production does
 *     not have.
 *
 * This config boots the built binary and nothing else: it embeds the console
 * and the hosted login shell (`internal/staticui/*`), serves the ogen API at
 * the origin root, and the browser visits that one origin. That makes it the
 * only lane where the console's API base and the mux's routing table have to
 * agree — the disagreement that shipped as "POST /api/flow returned 404".
 *
 * No `app` entry: the instance is the app server (see `withZitadel`).
 */
const appDir = import.meta.dirname;
const workspaceRoot = join(appDir, "../..");
// A fixed pin, deliberately outside the deferred-bind blocks (22000-23999
// journey runner / 24000-31999 embedded-pg — doctrine in
// apps/cli-journey-e2e/scripts/ports.mjs): withZitadel() needs the port while
// the Playwright config is evaluated, and those blocks are dynamically
// scanned reservation domains. Neighbors: 8092 demo-next-e2e e2e-real,
// 8093 console-e2e e2e-real, 8094 console dev-real.
const zitadelPort = Number(process.env.EMBEDDED_ZITADEL_PORT ?? 8095);
const origin = `http://localhost:${zitadelPort}`;

export default defineConfig({
  testDir: "./src-embedded",
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results/embedded",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/embedded" }]],
  use: {
    baseURL: origin,
    trace: "on-first-retry",
  },
  // Two workers cold-start Chromium and cold-load the console SPA
  // concurrently on a shared CI runner; the first visibility assertions sat
  // right at the 5s default (a 5.2s pass, then a 5.1s flake). Product
  // latency is not under test here — reachability is — so give readiness
  // assertions headroom.
  expect: { timeout: 10_000 },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    // The binary serves the UI, so the app origin *is* the instance origin.
    appOrigin: origin,
    // Not the default handshake.json: e2e-real shares this configDir, and a
    // concurrent run of both lanes must not have one supervisor delete and
    // rewrite the other's live handshake.
    handshakePath: join(appDir, ".zitadel-testing", "handshake-embedded.json"),
    zitadel: {
      // In-repo runs use the source-built binary; run `moon run server:build`
      // first (the moon task wires this env var). That build embeds the
      // current console and login-ui dists, so this suite always tests the
      // working tree's UI, not a stale one.
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
