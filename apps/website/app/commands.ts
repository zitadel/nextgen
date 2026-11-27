// The local preview with the published CLI, as the README's quick start runs
// it and the docs' quickstart without its optional `doctor` (AGENTS.md), in a
// new folder for the app: start, setup for a Next.js app, the app's dev
// server. The session the showcase was recorded from (showcase/sessions.ts)
// ran the same, with `doctor` first. The front page's hero and /get-started's
// walkthrough show them as numbered steps (`quickstart`), with the folder as
// their terminal's title, and the showcase's first two steps start and setup;
// /llms.txt hands them to agents after the folder's command; the footer
// offers start.
export const appFolder = "myapp";
// The folder as the windows' title bars show it.
export const appPath = `~/${appFolder}`;
export const folderCommand = `mkdir ${appFolder} && cd ${appFolder}`;
export const startCommand = "npx @zitadel/cli@latest start";
export const setupCommand = "npx @zitadel/cli@latest setup --framework next --server local";

export const devCommand = "npm run dev";

export const commands = [startCommand, setupCommand, devCommand];

// The same commands, each with what it does.
export const quickstart = [
  { label: "Start Zitadel on your machine", command: startCommand },
  { label: "Add sign-in to your app", command: setupCommand },
  { label: "Run your app", command: devCommand },
] as const;

// What publishes a change to the user model or the login flow, as steps 3
// and 4 run it and /llms.txt tells agents.
export const dryRunCommand = "npx @zitadel/cli@latest deploy --dry-run";
export const deployCommand = "npx @zitadel/cli@latest deploy";

// The skills of this repository, for any skills-compatible coding agent
// (README.md): the router skill, the CLI's, and one per framework SDK and
// component.
export const skillsCommand = "npx skills add zitadel/nextgen --full-depth";

// What the phase pages' Try it offers, as the docs and the CLI skill
// (apps/cli/skills/zitadel-cli/SKILL.md) spell each command; a placeholder in
// angle brackets is the reader's to fill.
export const policyTestCommand = "npx @zitadel/cli@latest policy test";
export const rollbackCommand = "npx @zitadel/cli@latest deployment rollback";
export const grantListCommand = "npx @zitadel/cli@latest grant list";
export const grantDeleteCommand = "npx @zitadel/cli@latest grant delete <grant_id>";
export const userEventsCommand = "npx @zitadel/cli@latest event list --filter user_id=<user-id>";
export const userSignInsCommand = `${userEventsCommand} --filter category=auth`;
export const actorEventsCommand = "npx @zitadel/cli@latest event list --filter actor_id=<user-id>";
export const correlationEventsCommand =
  "npx @zitadel/cli@latest event list --filter correlation_id=<id>";
export const failedRequestsCommand =
  "npx @zitadel/cli@latest event list --filter status_class=4xx --filter status_class=5xx";

// What the feature pages' Try it offers, spelled the same way.
export const passkeyEnableCommand = "npx @zitadel/cli@latest auth-method passkey enable";
export const googleEnableCommand =
  "npx @zitadel/cli@latest auth-method sso enable --provider google";
export const googleDisableCommand =
  "npx @zitadel/cli@latest auth-method sso disable --provider google";
export const customSsoCommand = "npx @zitadel/cli@latest auth-method sso enable --provider custom";
export const idpListCommand = "npx @zitadel/cli@latest idp list";
export const grantCreateCommand =
  "npx @zitadel/cli@latest grant create --relation viewer --user-identifier <email>";
export const membersCommand = "npx @zitadel/cli@latest api listProjectMembers";
export const userListCommand = "npx @zitadel/cli@latest user list";
export const invitationCommand = "npx @zitadel/cli@latest invitation create --relation admin";
