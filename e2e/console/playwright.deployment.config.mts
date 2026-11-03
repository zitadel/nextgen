import { defineConfig, devices } from "@playwright/test";

/**
 * The hosted cloud's console on a deployment (src-deployment/), which
 * CLOUD_URL names: how the repo-root vercel.json routes the console's paths,
 * and the console signed out, down to the login widget's first step. It signs
 * nobody in and holds no credential but Vercel's:
 * VERCEL_AUTOMATION_BYPASS_SECRET opens the deployment's protection
 * (docs/runbooks/cloud.md, "Deployment checks"); the production domain needs
 * none. `pnpm check:cloud` runs it beside every other deployment suite, and
 * .github/workflows/deployment-checks.yml runs it for every deployment.
 *
 * There is no local server: the lane checks what Vercel built and routed,
 * which the embedded lane cannot see.
 */
const deployment = process.env.CLOUD_URL;
if (!deployment) {
  throw new Error("CLOUD_URL names the deployment to test");
}
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
// GitHub Actions (deployment-checks.yml): annotations on the check that name
// the failing test and its assertion.
const onGitHub = !!process.env.GITHUB_RUN_ID;

export default defineConfig({
  testDir: "./src-deployment",
  fullyParallel: true,
  forbidOnly: onGitHub,
  // A deployment answers from cold the first time; one more try.
  retries: 1,
  outputDir: "test-results/deployment",
  // No HTML report: it keeps every error, and the error of a request that
  // failed lists the request's headers, the bypass secret among them.
  reporter: onGitHub ? [["list"], ["github"]] : "list",
  use: {
    baseURL: deployment,
    // The repository is public: anyone signed in to GitHub can download what
    // deployment-checks.yml uploads, so nothing uploaded may hold the bypass
    // secret. A trace records every request's headers, so there is none; a
    // screenshot shows only the page, and is all the workflow uploads.
    trace: "off",
    screenshot: "only-on-failure",
    // Every request the suite makes, from the request fixture and from the
    // browser, carries the bypass; a deployment without protection ignores
    // it. The console loads nothing from another origin, so it reaches no
    // one else. The skip keeps Vercel's toolbar out of a preview's pages, so
    // a policy violation the browser spec sees is the console's own.
    extraHTTPHeaders: {
      ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
      "x-vercel-skip-toolbar": "1",
    },
  },
  projects: [
    // The routing checks talk HTTP through the request fixture: no browser.
    { name: "requests", testIgnore: /\.browser\.spec\.ts$/ },
    { name: "chromium", testMatch: /\.browser\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
  ],
});
