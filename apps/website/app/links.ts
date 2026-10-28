// Where the page links to. The docs are another service of the same
// deployment (repo-root vercel.json), so every link is a plain <a>, never
// next/link (AGENTS.md).
export const links = {
  docs: "/docs",
  quickstart: "/docs/get-started/quickstart",
  llms: "/llms.txt",
  changelog: "/changelog",
  chooseVersion: "/choose-version",
  github: "https://github.com/zitadel/nextgen",
  issues: "https://github.com/zitadel/nextgen/issues",
  // The nextgen channel on Zitadel's Discord, for questions.
  discord: "https://discord.com/channels/927474939156643850/1528728902896320672",
  releases: "https://github.com/zitadel/nextgen/releases",
  zitadel: "https://zitadel.com",
} as const;
