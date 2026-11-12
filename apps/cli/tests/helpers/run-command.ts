import { Command, type Config } from "@oclif/core";

import { cliPackageRoot } from "./oclif-build";

/**
 * Runs one command class on its own, as the command `id` of the CLI's own
 * package. A run suggests commands by id and renders them from what the loaded
 * CLI declares for that id, so it needs that config and that id; a class run
 * bare would load the config of whatever started the test runner.
 *
 * @param command - The command class.
 * @param id - The id oclif names it by (`variable:rm`).
 * @param argv - The command line after the command.
 * @returns What the command returned.
 */
export function runCommand(
  command: new (argv: string[], config: Config) => Command,
  id: string,
  argv: string[],
): ReturnType<typeof Command.run> {
  return Reflect.apply(Command.run, Object.assign(command, { id }), [argv, cliPackageRoot]);
}
