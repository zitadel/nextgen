import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { withZitadel } from "@zitadel/testing/playwright";

/**
 * Recorded walkthroughs of the embedded console (#1300).
 *
 * Same server shape as `playwright.embedded.config.mts` — the built binary
 * serving the console and the API at one origin, no Vite proxy, so no project
 * secret ever reaches a console request — but the output is a video, not a
 * verdict. The specs visit every management screen at a readable pace and
 * never fail on what they find: an error state on screen *is* the result a
 * reviewer wants to see. Videos land in `walkthrough-videos/`, named by
 * `WALKTHROUGH_LABEL` so a PR can show a before and an after — as WebM, plus
 * an H.264 MP4 (the one GitHub plays inline) when ffmpeg is on PATH.
 */
const appDir = import.meta.dirname;
const workspaceRoot = join(appDir, "../..");
// Neighbors: 8092 demo-next-e2e e2e-real, 8093 console-e2e e2e-real,
// 8094 console dev-real, 8095 console-e2e e2e-embedded.
const zitadelPort = Number(process.env.WALKTHROUGH_ZITADEL_PORT ?? 8096);
const origin = `http://localhost:${zitadelPort}`;
const viewport = { width: 1280, height: 800 };

export default defineConfig({
  testDir: "./src-walkthrough",
  // One video at a time, in order: the recordings are the product.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 5 * 60_000,
  outputDir: "test-results/walkthrough",
  reporter: [["list"]],
  use: {
    baseURL: `${origin}/ui/console/`,
    viewport,
    video: { mode: "on", size: viewport },
    launchOptions: { slowMo: 250 },
  },
  expect: { timeout: 10_000 },
  ...withZitadel({
    configDir: appDir,
    port: zitadelPort,
    appOrigin: origin,
    handshakePath: join(appDir, ".zitadel-testing", "handshake-walkthrough.json"),
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
