import { defineConfig } from "@playwright/test";
import local from "./playwright.config.mts";

/**
 * The docs site's contract suite (tests/) against a deployment of the hosted
 * cloud, which CLOUD_URL names: `pnpm check:cloud` runs it beside every other
 * deployment suite, and .github/workflows/deployment-checks.yml runs it for
 * every deployment. Vercel's deployment protection opens for the project's
 * automation bypass secret, VERCEL_AUTOMATION_BYPASS_SECRET
 * (docs/runbooks/cloud.md, "Deployment checks"); the production domain needs
 * none.
 *
 * The specs and projects are the local build's (playwright.config.mts), so one
 * spec proves both; only the origin, the retries and what is recorded differ.
 */
const deployment = process.env.CLOUD_URL;
if (!deployment) {
  throw new Error("CLOUD_URL names the deployment to test");
}
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
// The skip keeps Vercel's toolbar out of a preview's pages, so a policy
// violation a browser spec sees is the docs' own.
const bypass: Record<string, string> = {
  ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
  "x-vercel-skip-toolbar": "1",
};
// GitHub Actions (deployment-checks.yml): annotations on the check that name
// the failing test and its assertion.
const onGitHub = !!process.env.GITHUB_RUN_ID;

export default defineConfig({
  ...local,
  // A deployment answers from cold the first time; one more try.
  retries: 1,
  // No HTML report: it keeps every error, and the error of a request that
  // failed lists the request's headers, the bypass secret among them.
  reporter: onGitHub ? [["list"], ["github"]] : "list",
  use: {
    ...local.use,
    baseURL: deployment,
    // The repository is public: anyone signed in to GitHub can download what
    // deployment-checks.yml uploads, so nothing uploaded may hold the bypass
    // secret. A trace records every request's headers, so there is none; a
    // screenshot shows only the page, and is all the workflow uploads.
    trace: "off",
    // Every request the suite makes, from the request fixture and from the
    // browser, carries the bypass; a deployment without protection ignores it.
    extraHTTPHeaders: bypass,
  },
  // The browser also asks for the bypass cookie, which carries the bypass on
  // to what the live examples' service worker fetches in the page's place
  // (tests/examples.browser.spec.ts). Vercel sets it with a 307 to the same
  // URL, which over the request fixture would stand in for the redirects the
  // specs check, so only the browser asks.
  projects: local.projects?.map((project) =>
    project.name === "chromium" && bypassSecret
      ? {
          ...project,
          use: {
            ...project.use,
            extraHTTPHeaders: { ...bypass, "x-vercel-set-bypass-cookie": "true" },
          },
        }
      : project,
  ),
  // The deployment serves itself.
  webServer: undefined,
});
