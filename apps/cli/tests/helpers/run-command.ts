import { Command, type Config } from "@oclif/core";

import { cliPackageRoot } from "./oclif-build";

/**
 * Runs one command class on its own, as the command `id` of the CLI's own
 * package. A run suggests commands by id and renders them from what the loaded
 * CLI declares for that id, and rebuilds itself by its own id, so it needs that
 * config and that id; a class run bare would load the config of whatever
 * started the test runner. The id is set for this run alone and the class is
 * left as the test imported it.
 *
 * @param command - The command class.
 * @param id - The id oclif names it by (`variable:rm`).
 * @param argv - The command line after the command.
 * @returns What the command returned.
 */
export async function runCommand(
  command: new (argv: string[], config: Config) => Command,
  id: string,
  argv: string[],
): Promise<Awaited<ReturnType<typeof Command.run>>> {
  const before = Object.getOwnPropertyDescriptor(command, "id");
  Object.defineProperty(command, "id", { value: id, configurable: true, writable: true });
  try {
    return await Reflect.apply(Command.run, command, [argv, cliPackageRoot]);
  } finally {
    // Put the class back as the test imported it, so a later run of it on its
    // own does not inherit this one's id.
    if (before === undefined) {
      Reflect.deleteProperty(command, "id");
    } else {
      Object.defineProperty(command, "id", before);
    }
  }
}
