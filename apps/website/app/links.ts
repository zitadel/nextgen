// Where the page links to. The docs are another service of the same
// deployment (repo-root vercel.json), so every link is a plain <a>, never
// next/link (AGENTS.md).
export const links = {
  docs: "/docs",
  quickstart: "/docs/get-started/quickstart",
  llms: "/llms.txt",
  changelog: "/changelog",
  pricing: "/pricing",
  // The console of the cloud this page is served from, where a team upgrades.
  console: "/console/",
  chooseVersion: "/choose-version",
  github: "https://github.com/zitadel/nextgen",
  issues: "https://github.com/zitadel/nextgen/issues",
  // The invite to Zitadel's Discord, which has the nextgen channel: a link to
  // the channel itself assumes the reader has already joined.
  discord: "https://zitadel.com/chat",
  releases: "https://github.com/zitadel/nextgen/releases",
  changelogFeed: "/changelog/feed.xml",
  zitadel: "https://zitadel.com",
  // Where an Enterprise quote starts: the pricing page lists no Enterprise price.
  contact: "https://zitadel.com/contact",
} as const;
