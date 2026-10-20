import { applyCommand, commands, folderCommand, planCommand, skillsCommand } from "../commands";
import { sessions } from "../showcase/sessions";

// The host's llms.txt (llmstxt.org): what the preview is, the commands, what
// they leave behind and how to change it, then where an agent reads on. The
// files come from the showcase's data (showcase/sessions.ts), so the page and
// this file never disagree. The docs keep the index of their own pages at
// /docs/llms.txt. Served at /llms.txt through a rewrite of its own in the
// repo-root vercel.json (AGENTS.md).
const files = sessions
  .flatMap(({ scaffold }) => scaffold?.entries ?? [])
  .map(({ path, note }) => `- \`${path}\`: ${note}`)
  .join("\n");

const body = `# Zitadel (developer preview)

> Your login in one minute. Zitadel is open-source auth for users, services, and AI agents that lives in the app's repo: one terminal session gives an app a local Zitadel with login, registration, and profile pages, and the user model, the login flow, and the styling are files in the repo. This is the preview of the next Zitadel: APIs, CLI flags and packages still change.

Run it locally with the published CLI (Node.js 24 or newer), in a new folder for a Next.js app. Every Zitadel command takes \`--non-interactive --json\` and prints one JSON envelope on stdout:

\`\`\`sh
${[folderCommand, ...commands].join("\n")}
\`\`\`

\`start\` runs Zitadel on the machine and signs in to its console; users, passwords and sessions live there, not in the app. \`setup\` writes these files into the app, and \`npm run dev\` serves the login:

${files}

To change the user model or the login flow, edit those files, then publish the change: \`${planCommand}\` shows what changes, \`${applyCommand}\` makes it live. To match a brand, set the login's \`--zl-*\` design tokens on \`zitadel-login\` in the app's own stylesheet.

Install the Zitadel skills into a skills-compatible agent: \`${skillsCommand}\`.

## Not supported yet

- Account linking: a social sign-in never links to an existing account. A user with a password account who signs in with Google lands on "You already have an account" every time.
- Password recovery: the login has no "forgot password" step, because the server sends no email yet (the dev inbox, ADR 050, and recovery, ADR 038, are still proposals).

## Docs

- [Docs index](/docs/llms.txt): every page of the docs, with its Markdown URL
- [Full docs](/docs/llms-full.txt): every page except the API operations, in one file
- [Quickstart](/docs/get-started/quickstart.md): from an empty folder to working local auth
- [Agent setup](/docs/get-started/agents.md): the CLI's JSON contract and the browser proof
- [Flows and schemas](/docs/concepts/flows-and-schemas.md): how login flows, user schemas and the generated UI relate
- [Plan and apply](/docs/cli/plan-apply.md): edit the local configuration and sync it
- [Add social sign-in](/docs/cli/social-sign-in.md): "Sign in with Google" or any OpenID Connect provider, with \`zitadel auth-method sso enable\`
- [Customize the login design](/docs/cli/customize-design.md): a starter design, your branding, published as a revision
- [Docs MCP server](/docs/api/mcp): the tools search, list_pages and get_page

## Optional

- [Local runtime](/docs/concepts/local-runtime.md): how the CLI starts and stores local Zitadel state
- [Repo configuration](/docs/concepts/repo-config.md): how the app's auth configuration stays reviewable
- [Source](https://github.com/zitadel/nextgen): the repository on GitHub
- [Vision](https://github.com/zitadel/nextgen/blob/main/VISION.md): the four pillars and where each stands
- [Zitadel v4](https://zitadel.com): the current release, for production
`;

export const revalidate = false;

export function GET() {
  return new Response(body);
}
