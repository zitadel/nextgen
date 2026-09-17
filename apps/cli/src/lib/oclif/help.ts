import { type Command, Help, toConfiguredId, ux } from "@oclif/core";

import { ADDITIONAL_COMMANDS_GROUP, COMMAND_GROUPS, type CommandGroup } from "./groups";

/** A loaded command plus the root-help statics `BaseCommand` (`./base`) declares. */
type GroupedCommand = Command.Loadable & { group?: CommandGroup; groupOrder?: number };

/**
 * Summaries for oclif plugin commands that ship without one. `version` prints
 * a blank line otherwise.
 */
const PLUGIN_SUMMARIES: Readonly<Record<string, string>> = {
  version: "Show the CLI version",
};

/**
 * Root help in the style of `gh --help`: a tagline, usage, the commands under
 * headed groups with oclif's utilities last, then flags, examples, and where
 * to go next. Only {@link showRootHelp} is replaced; per-command and
 * per-topic help (`start --help`, `schemas --help`) stay oclif's own. Wired
 * in via `oclif.helpClass` in `package.json`.
 */
export default class ZitadelHelp extends Help {
  protected override async showRootHelp(): Promise<void> {
    const { bin } = this.config;
    const commands = this.rootCommands();
    const width = Math.max(0, ...commands.map((command) => this.displayName(command).length));
    const list = (entries: readonly GroupedCommand[]): string =>
      entries
        .map(
          (command) => `${this.displayName(command).padEnd(width)} ${this.oneLineSummary(command)}`,
        )
        .join("\n");

    const groups = COMMAND_GROUPS.map((group) => [group, byGroup(commands, group)] as const).filter(
      ([, entries]) => entries.length > 0,
    );
    const additional = commands
      .filter((command) => command.group === undefined)
      .sort((a, b) => a.id.localeCompare(b.id));

    const sections = [
      this.render(this.config.pjson.oclif.description ?? this.config.pjson.description ?? ""),
      this.section("Usage", `${bin} <command> [flags]`),
      ...groups.map(([group, entries]) => this.section(group, list(entries))),
      ...(additional.length > 0 ? [this.section(ADDITIONAL_COMMANDS_GROUP, list(additional))] : []),
      this.section(
        "Flags",
        ["--help      Show help for command", `--version   Show ${bin} version`].join("\n"),
      ),
      this.section(
        "Examples",
        [`$ ${bin} setup --framework next`, `$ ${bin} start`, `$ ${bin} doctor`].join("\n"),
      ),
      this.section(
        "Learn more",
        `Use \`${bin} <command> --help\` for more information about a command.`,
      ),
    ];
    this.log(sections.join("\n\n"));
  }

  /**
   * The commands the root screen lists: every visible command, grouped or
   * not, whatever its depth. Alias entries and `help` itself are left out.
   */
  private rootCommands(): GroupedCommand[] {
    return (this.sortedCommands as GroupedCommand[]).filter(
      (command) => command.id !== "help" && !command.aliases?.includes(command.id),
    );
  }

  private displayName(command: GroupedCommand): string {
    return `${toConfiguredId(command.id, this.config)}:`;
  }

  /**
   * The summary as `gh` prints it: the first clause of the summary or
   * description, with no trailing full stop. Built from the raw statics rather
   * than {@link summary} so a user theme's colour codes cannot end up inside
   * the clause; the theme is applied once the text is final.
   */
  private oneLineSummary(command: GroupedCommand): string {
    const source = PLUGIN_SUMMARIES[command.id] ?? command.summary ?? command.description ?? "";
    const [clause = ""] = this.render(source).split(/[.:]\s|\n/, 1);
    return ux.colorize(this.config.theme?.commandSummary, clause.trim().replace(/\.$/, ""));
  }
}

function byGroup(commands: readonly GroupedCommand[], group: CommandGroup): GroupedCommand[] {
  return commands
    .filter((command) => command.group === group)
    .sort(
      (a, b) =>
        (a.groupOrder ?? Number.MAX_SAFE_INTEGER) - (b.groupOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
}
