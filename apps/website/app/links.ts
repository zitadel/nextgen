// Where the page links to. The docs are another service of the same
// deployment (repo-root vercel.json), so every link is a plain <a>, never
// next/link (AGENTS.md).
export const links = {
  docs: "/docs",
  quickstart: "/docs/get-started/quickstart",
  llms: "/llms.txt",
  changelog: "/changelog",
  github: "https://github.com/zitadel/nextgen",
  issues: "https://github.com/zitadel/nextgen/issues",
  releases: "https://github.com/zitadel/nextgen/releases",
  releasesFeed: "https://github.com/zitadel/nextgen/releases.atom",
  zitadel: "https://zitadel.com",
} as const;
