import { defineConfig, devices } from "@playwright/test";

/**
 * The docs site's contract suite (tests/), against any origin that serves the
 * docs under /docs:
 *
 * - `moon run docs:e2e`: the local build. Playwright starts `next start` on
 *   port 3003, or reuses one (`moon run docs:start`).
 * - `moon run docs:e2e-deployment`: a deployment of the hosted cloud, which
 *   DOCS_BASE_URL names. Vercel's deployment protection opens for the
 *   project's automation bypass secret, VERCEL_AUTOMATION_BYPASS_SECRET
 *   (docs/runbooks/cloud.md, "Deployment checks").
 *
 * The specs only ever use paths, so the same spec proves the local build and
 * the artifact Vercel built and routed.
 */
const deployment = process.env.DOCS_BASE_URL;
const localOrigin = "http://localhost:3003";
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A deployment answers from cold the first time; one more try there.
  retries: deployment ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: deployment ?? localOrigin,
    trace: "on-first-retry",
    // Every request the suite makes, from the request fixture and from the
    // browser, carries the bypass; a deployment without protection ignores it.
    extraHTTPHeaders: bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {},
  },
  webServer: deployment
    ? undefined
    : {
        command: "corepack pnpm exec next start --port 3003",
        url: `${localOrigin}/docs/llms.txt`,
        reuseExistingServer: true,
        timeout: 60_000,
      },
  projects: [
    // Most of the suite talks HTTP through the request fixture: no browser.
    { name: "requests", testIgnore: /\.browser\.spec\.ts$/ },
    { name: "chromium", testMatch: /\.browser\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
  ],
});
