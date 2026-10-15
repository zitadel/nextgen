import { commands, skillsCommand } from "../commands";

// The host's llms.txt (llmstxt.org): what the preview is and where an agent
// reads on. The docs keep the index of their own pages at /docs/llms.txt.
// Served at /llms.txt through a rewrite of its own in the repo-root
// vercel.json (AGENTS.md).
const body = `# Zitadel (developer preview)

> A login experience you control, in one minute. Zitadel is the open-source identity platform for users, services, and AI agents, built for developers and the agents they work with. One terminal session gives an app a local Zitadel with login, registration, and profile pages; the user model, the login flow, and the styling are files in the app's repo. This is the preview of the next Zitadel: APIs, CLI flags and packages still change.

Run it locally with the published CLI (Node.js 24 or newer). Every Zitadel command takes \`--non-interactive --json\` and prints one JSON envelope on stdout:

\`\`\`sh
${commands.join("\n")}
\`\`\`

Install the Zitadel skills into a skills-compatible agent: \`${skillsCommand}\`.

## Docs

- [Docs index](/docs/llms.txt): every page of the docs, with its Markdown URL
- [Full docs](/docs/llms-full.txt): every page except the API operations, in one file
- [Quickstart](/docs/get-started/quickstart.md): from an empty folder to working local auth
- [Agent setup](/docs/get-started/agents.md): the CLI's JSON contract and the browser proof
- [Docs MCP server](/docs/api/mcp): the tools search, list_pages and get_page

## Optional

- [Source](https://github.com/zitadel/nextgen): the repository on GitHub
- [Vision](https://github.com/zitadel/nextgen/blob/main/VISION.md): the four pillars and where each stands
- [Zitadel v4](https://zitadel.com): the current release, for production
`;

export const revalidate = false;

export function GET() {
  return new Response(body);
}
