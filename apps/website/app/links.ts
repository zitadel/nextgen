// Where the page links to. The docs and the storybook are other services of
// the same deployment (repo-root vercel.json), so every link is a plain <a>,
// never next/link (AGENTS.md).
export const links = {
  docs: "/docs",
  quickstart: "/docs/get-started/quickstart",
  agentSetup: "/docs/get-started/agents",
  planApply: "/docs/cli/plan-apply",
  customizeDesign: "/docs/cli/customize-design",
  eventsApi: "/docs/reference/api/events",
  docsIndex: "/docs/llms.txt",
  // The overview's section on llms.txt, the Markdown and the MCP server.
  llmSupport: "/docs#llm-support",
  storybook: "/storybook/",
  github: "https://github.com/zitadel/nextgen",
  vision: "https://github.com/zitadel/nextgen/blob/main/VISION.md",
  // Zitadel as it ships today, for production.
  zitadel: "https://zitadel.com",
} as const;
