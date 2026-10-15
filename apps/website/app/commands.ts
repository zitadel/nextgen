// The local preview with the published CLI, as the docs' quickstart and the
// README run it (AGENTS.md), and as the first recorded session of the showcase
// (showcase/sessions.ts) ran it: a new folder, doctor, start, setup for a
// Next.js app, the app's dev server. The hero shows them; /llms.txt hands them
// to agents.
export const commands = [
  "mkdir myapp && cd myapp",
  "npx @zitadel/cli@alpha doctor",
  "npx @zitadel/cli@alpha start",
  "npx @zitadel/cli@alpha setup --framework next --server local",
  "npm run dev",
];

// The skills of this repository, for any skills-compatible coding agent
// (README.md): the router skill, the CLI's, and one per framework SDK and
// component.
export const skillsCommand = "npx skills add zitadel/nextgen --full-depth";
