import { describe, expect, it } from "vitest";

import {
  matchesPattern,
  normalizeOrigin,
  parseTtl,
  platformPreviewOrigins,
  relativeExpiry,
  targetLabel,
} from "../../../src/lib/deployments";

describe("platformPreviewOrigins", () => {
  it("reads both Vercel URLs and prepends https", () => {
    expect(
      platformPreviewOrigins({
        VERCEL_BRANCH_URL: "acme-git-sso-acmeinc.vercel.app",
        VERCEL_URL: "acme-k3x9v2-acmeinc.vercel.app",
      }),
    ).toEqual({
      platform: "vercel",
      origins: [
        { url: "https://acme-git-sso-acmeinc.vercel.app", variable: "VERCEL_BRANCH_URL" },
        { url: "https://acme-k3x9v2-acmeinc.vercel.app", variable: "VERCEL_URL" },
      ],
    });
  });

  it("reads Netlify's full URLs", () => {
    expect(
      platformPreviewOrigins({
        DEPLOY_PRIME_URL: "https://feat--acme-site.netlify.app",
        DEPLOY_URL: "https://deploy-preview-12--acme-site.netlify.app",
      })?.origins.map((o) => o.url),
    ).toEqual([
      "https://feat--acme-site.netlify.app",
      "https://deploy-preview-12--acme-site.netlify.app",
    ]);
  });

  it("builds the Cloudflare Pages branch alias from the deployment URL", () => {
    expect(
      platformPreviewOrigins({
        CF_PAGES_BRANCH: "feat/SSO",
        CF_PAGES_URL: "https://a1b2c3.acme-app.pages.dev",
      })?.origins.map((o) => o.url),
    ).toEqual(["https://feat-sso.acme-app.pages.dev", "https://a1b2c3.acme-app.pages.dev"]);
  });

  it("finds nothing outside a platform build", () => {
    expect(platformPreviewOrigins({ NODE_ENV: "production" })).toBeUndefined();
  });
});

describe("parseTtl", () => {
  it.each([
    ["7d", 604_800],
    ["24h", 86_400],
    ["30m", 1_800],
    ["3600", 3_600],
  ])("parses %s", (raw, seconds) => {
    expect(parseTtl(raw)).toBe(seconds);
  });

  it("refuses nonsense and out-of-range values", () => {
    expect(() => parseTtl("soon")).toThrow(/Invalid --ttl/);
    expect(() => parseTtl("10s")).toThrow(/between 1m and 30d/);
    expect(() => parseTtl("31d")).toThrow(/between 1m and 30d/);
  });
});

describe("matchesPattern", () => {
  it("matches a literal exactly and a star as one or more non-dot characters", () => {
    expect(matchesPattern("https://app.acme.com", "https://app.acme.com")).toBe(true);
    expect(matchesPattern("https://app.acme.com", "https://www.acme.com")).toBe(false);
    expect(matchesPattern("https://*-acmeinc.vercel.app", "https://acme-git-sso-acmeinc.vercel.app")).toBe(true);
    expect(matchesPattern("https://*-acmeinc.vercel.app", "https://evil.acmeinc.vercel.app")).toBe(false);
    expect(matchesPattern("https://*.preview.acme.com", "https://pr-12.preview.acme.com")).toBe(true);
    expect(matchesPattern("https://*.preview.acme.com", "https://a.b.preview.acme.com")).toBe(false);
  });
});

describe("rendering helpers", () => {
  it("labels the empty origin as the default", () => {
    expect(targetLabel("")).toBe("(default)");
    expect(targetLabel("https://app.acme.com")).toBe("https://app.acme.com");
  });

  it("normalises an origin to scheme and host", () => {
    expect(normalizeOrigin("https://App.Acme.com/path")).toBe("https://app.acme.com");
    expect(normalizeOrigin("acme.vercel.app")).toBe("https://acme.vercel.app");
  });

  it("renders expiry relative to now", () => {
    const now = Date.parse("2026-10-02T00:00:00Z");
    expect(relativeExpiry("2026-10-08T00:00:00Z", now)).toBe("in 6d");
    expect(relativeExpiry("2026-10-02T03:00:00Z", now)).toBe("in 3h");
    expect(relativeExpiry("2026-10-01T00:00:00Z", now)).toBe("expired");
    expect(relativeExpiry(null, now)).toBe("");
  });
});
