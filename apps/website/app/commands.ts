// The local preview with the published CLI, as the README's quick start runs
// it and the docs' quickstart without its optional `doctor` (AGENTS.md): a new
// folder, start, setup for a Next.js app, the app's dev server. The session the
// showcase was recorded from (showcase/sessions.ts) ran the same, with `doctor`
// first. The hero shows them; /llms.txt hands them to agents.
export const commands = [
  "mkdir myapp && cd myapp",
  "npx @zitadel/cli@alpha start",
  "npx @zitadel/cli@alpha setup --framework next --server local",
  "npm run dev",
];

// The skills of this repository, for any skills-compatible coding agent
// (README.md): the router skill, the CLI's, and one per framework SDK and
// component.
export const skillsCommand = "npx skills add zitadel/nextgen --full-depth";
