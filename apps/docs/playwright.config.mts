import { defineConfig, devices } from "@playwright/test";

/**
 * The docs site's contract suite (tests/) against the local build:
 * `moon run docs:e2e`. Playwright starts `next start` on port 3003, or reuses
 * one (`moon run docs:start`).
 *
 * playwright.deployment.config.mts runs the same specs against a deployment
 * of the hosted cloud. The specs only ever use paths, so the same spec proves
 * the local build and the artifact Vercel built and routed.
 */
const localOrigin = "http://localhost:3003";
// GitHub Actions: annotations on the check that name the failing test and its
// assertion.
const onGitHub = !!process.env.GITHUB_RUN_ID;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: onGitHub,
  reporter: onGitHub ? [["list"], ["github"]] : "list",
  use: {
    baseURL: localOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
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
