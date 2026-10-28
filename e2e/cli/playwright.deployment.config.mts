import { defineConfig, devices } from "@playwright/test";

/**
 * The `zitadel` CLI against a deployment of the hosted cloud, which CLOUD_URL
 * names (src-deployment/): this commit's packed CLI sets up a project on the
 * deployment from an empty directory and drives it there, and a browser
 * finishes the claim the CLI starts. VERCEL_AUTOMATION_BYPASS_SECRET opens
 * the deployment's protection (docs/runbooks/cloud.md, "Deployment checks"):
 * the browser sends it, and the CLI's requests pass a local proxy that adds
 * it (support/bypass-proxy.ts), so the CLI holds no secret. `pnpm check:cloud`
 * runs it beside every other deployment suite, and
 * .github/workflows/deployment-checks.yml runs it for every preview: each run
 * leaves a project behind in the deployment's database, and only a preview's
 * is its own. On the production domain every test skips.
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
  // Packs and installs the CLI once, and runs the bypass proxy for the run.
  globalSetup: "./global-setup.ts",
  // One project, carried from test to test.
  workers: 1,
  forbidOnly: onGitHub,
  // A retry starts the serial suite over, with a new project in a new
  // directory: a deployment answers from cold the first time.
  retries: 1,
  timeout: 120_000,
  outputDir: "test-results/deployment",
  // No HTML report: it keeps every error, and the error of a request that
  // failed lists the request's headers, the bypass secret among them.
  reporter: onGitHub ? [["list"], ["github"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: deployment,
    // Nothing the workflow could upload may hold the bypass secret, which a
    // trace records with every request's headers. A screenshot shows only the
    // page, and is all the workflow uploads.
    trace: "off",
    screenshot: "only-on-failure",
    extraHTTPHeaders: bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {},
  },
});
