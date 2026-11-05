import { defineConfig } from "@playwright/test";

/**
 * The built-in schemas on a deployment of the hosted cloud, which CLOUD_URL
 * names (src-deployment/): the `schemas` service of the repo-root vercel.json,
 * which publishes each one under the namespace the server names them in, and
 * the routes around it. HTTP only, no browser, and no credential but Vercel's:
 * VERCEL_AUTOMATION_BYPASS_SECRET opens the deployment's protection
 * (docs/runbooks/cloud.md, "Deployment checks"); the production domain needs
 * none. `pnpm check:cloud` runs it beside every other deployment suite, and
 * .github/workflows/deployment-checks.yml runs it for every deployment.
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
    // Nothing the workflow could upload may hold the bypass secret, which a
    // trace records with every request's headers.
    trace: "off",
    extraHTTPHeaders: bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {},
  },
});
