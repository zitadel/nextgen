import { describe, expect, it } from "vitest";

import { robotsTxt, sitemapXml } from "./crawlers";

describe("robotsTxt", () => {
  it("keeps crawlers off a preview deployment", () => {
    expect(robotsTxt(false)).toBe("User-agent: *\nDisallow: /\n");
  });

  it("lets them into production, but for the API and the apps, and names the sitemap", () => {
    const robots = robotsTxt(true);
    expect(robots).not.toMatch(/^Disallow: \/$/m);
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
    expect(robots).toMatch(/^Sitemap: https:\/\/preview\.zitadel\.com\/sitemap\.xml$/m);
  });
});

describe("sitemapXml", () => {
  const xml = sitemapXml([
    { slug: "newer", date: "2026-11-20T09:30Z" },
    { slug: "older", date: "2026-10-21" },
  ]);

  it("lists every page and entry with an absolute URL", () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toEqual([
      "https://preview.zitadel.com/",
      "https://preview.zitadel.com/get-started",
      "https://preview.zitadel.com/operate",
      "https://preview.zitadel.com/investigate",
      "https://preview.zitadel.com/govern",
      "https://preview.zitadel.com/platform",
      "https://preview.zitadel.com/platform/user-management",
      "https://preview.zitadel.com/platform/passkeys-and-passwords",
      "https://preview.zitadel.com/platform/social-login",
      "https://preview.zitadel.com/platform/embedded-login",
      "https://preview.zitadel.com/platform/teams",
      "https://preview.zitadel.com/platform/single-sign-on",
      "https://preview.zitadel.com/platform/scim",
      "https://preview.zitadel.com/platform/permissions",
      "https://preview.zitadel.com/platform/oauth-server",
      "https://preview.zitadel.com/platform/agent-identity",
      "https://preview.zitadel.com/changelog",
      "https://preview.zitadel.com/choose-version",
      "https://preview.zitadel.com/changelog/newer",
      "https://preview.zitadel.com/changelog/older",
    ]);
  });

  it("dates the changelog by its newest entry and each entry by its day", () => {
    expect(xml).toContain(
      "<loc>https://preview.zitadel.com/changelog</loc>\n    <lastmod>2026-11-20</lastmod>",
    );
    expect(xml).toContain(
      "<loc>https://preview.zitadel.com/changelog/older</loc>\n    <lastmod>2026-10-21</lastmod>",
    );
  });
});
