import { Flags } from "@oclif/core";

import { CommandGroups } from "@/cli/commands/groups";
import { BaseCommand } from "@/cli/core";
import { Wrapped } from "@/cli/core/wrapped";
import { TELEMETRY_FLAG } from "@/cli/telemetry/telemetered";

/**
 * The flags of a built-in command: a built-in reports nothing, but takes
 * `--no-telemetry` like every command, so a script that appends it to each
 * invocation is not refused for the flag.
 */
const BUILT_IN_FLAGS = { ...BaseCommand.baseFlags, telemetry: TELEMETRY_FLAG };

/**
 * `zitadel version`: the CLI's version, as the envelope's `data` under `--json`.
 *
 * Each wrapped command declares `strict` itself, because oclif reads a
 * class's own statics, so a parent's does not reach it.
 */
export class Version extends Wrapped(BaseCommand) {
  static override readonly wrapsPlugin = "@oclif/plugin-version";
  static override description = "Show the CLI version.";
  static override group = CommandGroups.cli;
  static override strict = false;
  static override baseFlags = BUILT_IN_FLAGS;
}

/**
 * `zitadel commands`: every command of the CLI, as the envelope's `data`
 * under `--json`.
 */
export class Commands extends Wrapped(BaseCommand) {
  static override readonly wrapsPlugin = "@oclif/plugin-commands";
  static override description = "List all <%= config.bin %> commands.";
  static override group = CommandGroups.cli;
  static override strict = false;
  static override baseFlags = BUILT_IN_FLAGS;
  static override flags = {
    columns: Flags.string({
      delimiter: ",",
      description: "Only show provided columns (comma-separated).",
      multiple: true,
      options: ["id", "plugin", "summary", "type"],
    }),
    deprecated: Flags.boolean({ description: "Show deprecated commands." }),
    extended: Flags.boolean({
      char: "x",
      description: "Show extra columns.",
    }),
    hidden: Flags.boolean({ description: "Show hidden commands." }),
    "no-truncate": Flags.boolean({ description: "Do not truncate output." }),
    sort: Flags.option({
      default: "id",
      description: "Property to sort by.",
      options: ["id", "plugin", "summary", "type"] as const,
    })(),
    tree: Flags.boolean({ description: "Show tree of commands." }),
  };
}

/**
 * `zitadel which`: the command a set of words runs.
 */
export class Which extends Wrapped(BaseCommand) {
  static override readonly wrapsPlugin = "@oclif/plugin-which";
  static override description = "Show which plugin a command is in.";
  static override group = CommandGroups.cli;
  static override strict = false;
  static override baseFlags = BUILT_IN_FLAGS;
}

/**
 * `zitadel help`: the help of a command.
 */
export class Help extends Wrapped(BaseCommand) {
  static override readonly wrapsPlugin = "@oclif/plugin-help";
  static override description = "Display help for <%= config.bin %>.";
  static override group = CommandGroups.cli;
  static override strict = false;
  static override baseFlags = BUILT_IN_FLAGS;
  static override flags = {
    "nested-commands": Flags.boolean({ description: "Include all nested commands in the output." }),
  };
}

/**
 * `zitadel autocomplete`: the shell completion setup.
 */
export class Autocomplete extends Wrapped(BaseCommand) {
  static override readonly wrapsPlugin = "@oclif/plugin-autocomplete";
  static override description = "Display autocomplete installation instructions.";
  static override group = CommandGroups.cli;
  static override strict = false;
  static override baseFlags = BUILT_IN_FLAGS;
  static override flags = {
    "refresh-cache": Flags.boolean({
      char: "r",
      description: "Refresh cache (ignores displaying instructions).",
    }),
  };
}
