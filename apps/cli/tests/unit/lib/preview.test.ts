import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import { detectPreviewUrls, parseTtl } from "../../../src/lib/preview";

describe("parseTtl", () => {
  it("keeps a whole unit as it is written", () => {
    expect(parseTtl("7d")).toEqual({ wire: "7d", ms: 7 * 24 * 60 * 60 * 1000 });
    expect(parseTtl("12h")).toEqual({ wire: "12h", ms: 12 * 60 * 60 * 1000 });
    expect(parseTtl("90m")).toEqual({ wire: "90m", ms: 90 * 60 * 1000 });
  });

  it("re-expresses seconds in the coarsest exact wire unit", () => {
    expect(parseTtl("3600s").wire).toBe("1h");
    expect(parseTtl("86400s").wire).toBe("1d");
    expect(parseTtl("120s").wire).toBe("2m");
  });

  it("rounds seconds that are not a whole minute up to the next minute", () => {
    expect(parseTtl("90s").wire).toBe("2m");
  });

  it("accepts the bounds and refuses a value outside them", () => {
    expect(parseTtl("60s").wire).toBe("1m");
    expect(parseTtl("30d").wire).toBe("30d");
    expect(() => parseTtl("30s")).toThrow(ZitadelError);
    expect(() => parseTtl("31d")).toThrow(ZitadelError);
  });

  it("refuses a value that is not a whole number of s, m, h or d", () => {
    expect(() => parseTtl("7")).toThrow(ZitadelError);
    expect(() => parseTtl("1w")).toThrow(ZitadelError);
    expect(() => parseTtl("0d")).toThrow(ZitadelError);
    expect(() => parseTtl("1.5h")).toThrow(ZitadelError);
  });
});

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

  it("reports the Cloudflare Pages deployment URL and the derived branch alias", () => {
    const detected = detectPreviewUrls({
      CF_PAGES_BRANCH: "sso/Feature_Branch",
      CF_PAGES_URL: "https://a1b2c3.acme.pages.dev",
    });
    expect(detected.urls).toEqual([
      "https://a1b2c3.acme.pages.dev",
      "https://sso-feature-branch.acme.pages.dev",
    ]);
  });

  it("finds nothing when no platform variable is set, but names them all", () => {
    const detected = detectPreviewUrls({});
    expect(detected.urls).toEqual([]);
    expect(detected.variablesLookedFor).toEqual([
      "VERCEL_BRANCH_URL",
      "VERCEL_URL",
      "DEPLOY_PRIME_URL",
      "DEPLOY_URL",
      "CF_PAGES_BRANCH",
      "CF_PAGES_URL",
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
