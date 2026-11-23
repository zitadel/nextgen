import { Flags } from "@oclif/core";

import { CommandGroups } from "@/cli/commands/groups";
import { BaseCommand } from "@/lib/oclif";
import { Wrapped } from "@/lib/oclif/wrapped";

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
}

/**
 * `zitadel help`: the help of a command.
 */
export class Help extends Wrapped(BaseCommand) {
  static override readonly wrapsPlugin = "@oclif/plugin-help";
  static override description = "Display help for <%= config.bin %>.";
  static override group = CommandGroups.cli;
  static override strict = false;
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
  static override flags = {
    "refresh-cache": Flags.boolean({
      char: "r",
      description: "Refresh cache (ignores displaying instructions).",
    }),
  };
}
