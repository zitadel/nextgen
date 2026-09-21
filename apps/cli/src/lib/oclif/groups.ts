/**
 * The groups the root help lists commands under, declared in print order: the
 * journey runs from setting up a project, to running the local server, to
 * managing its configuration, to acting on the resources inside it. Every command declares its own group
 * (`static group` on the class) so nothing has to be registered centrally; a
 * command without one lands in the trailing {@link ADDITIONAL_COMMANDS_GROUP}
 * with oclif's own utilities.
 */
export const CommandGroups = {
  project: "Project commands",
  localServer: "Local server commands",
  configuration: "Configuration commands",
  resources: "Resource commands",
} as const;

export type CommandGroup = (typeof CommandGroups)[keyof typeof CommandGroups];

export const COMMAND_GROUPS: readonly CommandGroup[] = Object.values(CommandGroups);

/** Where ungrouped commands (oclif's `autocomplete`, `search`, …) are listed. */
export const ADDITIONAL_COMMANDS_GROUP = "Additional commands";
