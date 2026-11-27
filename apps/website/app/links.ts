// Where the page links to. The docs are another service of the same
// deployment (repo-root vercel.json), so every link is a plain <a>, never
// next/link (AGENTS.md).
// The cloud's production host, for what needs absolute URLs (the changelog's
// feed, the sitemap); a preview deployment's link there as well.
export const origin = "https://preview.zitadel.com";

export const links = {
  docs: "/docs",
  quickstart: "/docs/get-started/quickstart",
  llms: "/llms.txt",
  changelog: "/changelog",
  chooseVersion: "/choose-version",
  github: "https://github.com/zitadel/nextgen",
  issues: "https://github.com/zitadel/nextgen/issues",
  // The invite to Zitadel's Discord, which has the nextgen channel: a link to
  // the channel itself assumes the reader has already joined.
  discord: "https://zitadel.com/chat",
  releases: "https://github.com/zitadel/nextgen/releases",
  changelogFeed: "/changelog/feed.xml",
  zitadel: "https://zitadel.com",
  // The split licensing (repo-root LICENSING.md) and how to report a
  // vulnerability (SECURITY.md, which /.well-known/security.txt follows).
  licensing: "https://github.com/zitadel/nextgen/blob/main/LICENSING.md",
  security: "https://github.com/zitadel/nextgen/blob/main/SECURITY.md",
  // Zitadel's policies, on zitadel.com.
  privacy: "https://zitadel.com/docs/legal/policies/privacy-policy",
  terms: "https://zitadel.com/docs/legal/terms-of-service",
} as const;
