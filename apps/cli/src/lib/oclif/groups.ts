/**
 * The groups the root help lists commands under, declared in print order and
 * named for what a developer is trying to do: get going, work against a local
 * server, manage who can sign in and how, change the project's configuration,
 * or check on it. Every command declares its own group (`static group` on the
 * class) so nothing has to be registered centrally; oclif's own utilities
 * (`autocomplete`, `search`, …) declare none and are listed with the last group.
 */
export const CommandGroups = {
  gettingStarted: "Getting started",
  localDevelopment: "Local development",
  usersAndTeams: "Users and teams",
  authentication: "Authentication",
  configuration: "Configuration and releases",
  diagnostics: "Diagnostics and utilities",
} as const;

export type CommandGroup = (typeof CommandGroups)[keyof typeof CommandGroups];

export const COMMAND_GROUPS: readonly CommandGroup[] = Object.values(CommandGroups);

/**
 * The order within a group, which the root help and the docs' CLI reference
 * (`./reference`) share: `groupOrder` first, lowest first, then the command id.
 */
export function compareInGroup(
  a: { id: string; groupOrder?: number },
  b: { id: string; groupOrder?: number },
): number {
  return (
    (a.groupOrder ?? Number.MAX_SAFE_INTEGER) - (b.groupOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id)
  );
}
