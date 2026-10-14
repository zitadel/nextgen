import { describe, expect, it } from "vitest";

import { detectPreviewUrls } from "../../../src/lib/preview";

describe("detectPreviewUrls", () => {
  it("reads Vercel's branch and deployment hosts, prepending the scheme", () => {
    const detected = detectPreviewUrls({
      VERCEL_BRANCH_URL: "acme-git-sso-acmeinc.vercel.app",
      VERCEL_URL: "acme-k3x9v2-acmeinc.vercel.app",
    });
    expect(detected.urls).toEqual([
      "https://acme-git-sso-acmeinc.vercel.app",
      "https://acme-k3x9v2-acmeinc.vercel.app",
    ]);
  });

  it("reads Netlify's prime and deploy URLs as they are", () => {
    const detected = detectPreviewUrls({
      DEPLOY_PRIME_URL: "https://deploy-preview-7--acme.netlify.app",
      DEPLOY_URL: "https://62f--acme.netlify.app",
    });
    expect(detected.urls).toEqual([
      "https://deploy-preview-7--acme.netlify.app",
      "https://62f--acme.netlify.app",
    ]);
  });

  it("leaves a Cloudflare Pages URL to --origin, since production sets it too", () => {
    const detected = detectPreviewUrls({
      CF_PAGES_URL: "https://acme.pages.dev",
    });
    expect(detected.urls).toEqual([]);
  });

  it("finds nothing when no platform variable is set, but names them all", () => {
    const detected = detectPreviewUrls({});
    expect(detected.urls).toEqual([]);
    expect(detected.variablesLookedFor).toEqual([
      "VERCEL_BRANCH_URL",
      "VERCEL_URL",
      "DEPLOY_PRIME_URL",
      "DEPLOY_URL",
    ]);
  });

  it("de-duplicates and strips a trailing slash", () => {
    const detected = detectPreviewUrls({
      DEPLOY_PRIME_URL: "https://acme.netlify.app/",
      DEPLOY_URL: "https://acme.netlify.app",
    });
    expect(detected.urls).toEqual(["https://acme.netlify.app"]);
  });
});
