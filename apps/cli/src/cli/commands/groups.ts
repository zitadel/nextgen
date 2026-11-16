/**
 * The groups the root help lists commands under, declared in print order and
 * named for the task a developer is on: get going, run a local server, manage
 * who has access, set up how people sign in, change the project's settings,
 * ship releases, reach the API and its events, and use the CLI itself. A
 * heading is navigation only and never part of a command's syntax. Every
 * command declares its own group (`static group` on the class) so nothing has
 * to be registered centrally; oclif's own utilities (`autocomplete`, `search`,
 * …) declare none and are listed with the last group.
 */
export const CommandGroups = {
  gettingStarted: "Getting started",
  localServer: "Local server",
  usersAndAccess: "Users and access",
  signIn: "Sign-in",
  projectSettings: "Project settings",
  releases: "Releases",
  apiAndEvents: "API and events",
  cli: "CLI",
} as const;

export type CommandGroup = (typeof CommandGroups)[keyof typeof CommandGroups];

export const COMMAND_GROUPS: readonly CommandGroup[] = Object.values(CommandGroups);
