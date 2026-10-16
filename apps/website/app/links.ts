// Where the page links to. The docs are another service of the same
// deployment (repo-root vercel.json), so every link is a plain <a>, never
// next/link (AGENTS.md).
export const links = {
  docs: "/docs",
  quickstart: "/docs/get-started/quickstart",
  github: "https://github.com/zitadel/nextgen",
} as const;
