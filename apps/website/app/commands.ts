// The local preview with the published CLI, as the README's quick start runs
// it and the docs' quickstart without its optional `doctor` (AGENTS.md), in a
// new folder for the app: start, setup for a Next.js app, the app's dev
// server. The session the showcase was recorded from (showcase/sessions.ts)
// ran the same, with `doctor` first. The hero shows them, with the folder as
// its terminal's title, and the showcase's first two steps start and setup;
// /llms.txt hands them to agents after the folder's command; the footer
// offers start.
export const appFolder = "myapp";
// The folder as the windows' title bars show it.
export const appPath = `~/${appFolder}`;
export const folderCommand = `mkdir ${appFolder} && cd ${appFolder}`;
export const startCommand = "npx @zitadel/cli@alpha start";
export const setupCommand = "npx @zitadel/cli@alpha setup --framework next --server local";

export const commands = [startCommand, setupCommand, "npm run dev"];

// What publishes a change to the user model or the login flow, as steps 3
// and 4 run it and /llms.txt tells agents.
export const planCommand = "npx @zitadel/cli@alpha plan";
export const applyCommand = "npx @zitadel/cli@alpha apply";

// The skills of this repository, for any skills-compatible coding agent
// (README.md): the router skill, the CLI's, and one per framework SDK and
// component.
export const skillsCommand = "npx skills add zitadel/nextgen --full-depth";
