import { type Command, Help, type Interfaces, toConfiguredId, ux } from "@oclif/core";

import { exploreAllCommands } from "../journey-guidance";
import { showSkillsHint } from "../skills-hint";
import { COMMAND_GROUPS, type CommandGroup, CommandGroups, compareInGroup } from "./groups";

/** A loaded command plus the root-help statics `BaseCommand` (`./base`) declares. */
type GroupedCommand = Command.Loadable & { group?: CommandGroup; groupOrder?: number };

/** One line of the root screen: a command, or a family of commands under one name. */
type Row = { name: string; summary: string; order: number };

/**
 * Summaries for oclif plugin commands that ship without one. `version` prints
 * a blank line otherwise.
 */
const PLUGIN_SUMMARIES: Readonly<Record<string, string>> = {
  version: "Show the CLI version",
};

/**
 * Root help in the style of `gh --help`: a tagline, usage, the commands under
 * headed groups, then flags and examples. A family of commands (`users`,
 * `release`) is one row, and its own help lists the operations. Only
 * {@link showRootHelp} is replaced; per-command and per-topic help
 * (`start --help`, `schemas --help`) stay oclif's own, with a pointer back to
 * the root screen added. Wired in via `oclif.helpClass` in `package.json`.
 */
export default class ZitadelHelp extends Help {
  protected override async showRootHelp(): Promise<void> {
    const { bin } = this.config;
    const commands = this.rootCommands();
    const groups = COMMAND_GROUPS.map(
      (group) => [group, this.rowsOf(this.commandsOf(commands, group))] as const,
    ).filter(([, rows]) => rows.length > 0);
    const width = Math.max(0, ...groups.flatMap(([, rows]) => rows.map((row) => row.name.length)));
    const list = (rows: readonly Row[]): string =>
      rows.map((row) => `${row.name.padEnd(width)}  ${row.summary}`).join("\n");

    const sections = [
      this.render(this.config.pjson.oclif.description ?? this.config.pjson.description ?? ""),
      this.section("Usage", `${bin} <command> [flags]`),
      `Run a command below. Use \`${bin} <command> --help\` to see its options.`,
      ...groups.map(([group, rows]) => this.section(group, list(rows))),
      this.section(
        "Flags",
        ["--help      Show help for command", `--version   Show ${bin} version`].join("\n"),
      ),
      this.section(
        "Examples",
        [`$ ${bin} setup --framework next`, `$ ${bin} start`, `$ ${bin} doctor`].join("\n"),
      ),
    ];
    // Only a bare `zitadel`, not `zitadel --help` or an unknown command's help.
    if (process.argv.length <= 2) {
      await showSkillsHint({
        env: process.env,
        interactive: Boolean(process.stdout.isTTY && process.stdin.isTTY),
      });
    }
    this.log(sections.join("\n\n"));
  }

  override async showCommandHelp(command: Command.Loadable): Promise<void> {
    await super.showCommandHelp(command);
    this.log(exploreAllCommands(this.config.version));
  }

  override async showTopicHelp(topic: Interfaces.Topic): Promise<void> {
    await super.showTopicHelp(topic);
    this.log(exploreAllCommands(this.config.version));
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

  /**
   * The commands a group lists. oclif's own utilities declare no group and are
   * listed with the last one.
   */
  private commandsOf(commands: readonly GroupedCommand[], group: CommandGroup): GroupedCommand[] {
    return commands.filter(
      (command) =>
        command.group === group ||
        (command.group === undefined && group === CommandGroups.diagnostics),
    );
  }

  /**
   * The rows of one group. Commands sharing a first word (`users create`,
   * `users get`) are one row named for it, described by the topic when it has
   * a description and otherwise by the command of that name; a command on its
   * own keeps its name. Rows follow `groupOrder` (the lowest of a family's
   * commands), then the name.
   */
  private rowsOf(commands: readonly GroupedCommand[]): Row[] {
    const families = new Map<string, GroupedCommand[]>();
    for (const command of commands) {
      const [family = command.id] = command.id.split(":");
      families.set(family, [...(families.get(family) ?? []), command]);
    }
    const rows = [...families].map(([family, members]): Row => {
      const order = Math.min(
        ...members.map((member) => member.groupOrder ?? Number.MAX_SAFE_INTEGER),
      );
      const isFamily = members.some((member) => member.id.includes(":"));
      if (!isFamily) {
        const [only] = members;
        return {
          name: toConfiguredId(family, this.config),
          summary: this.oneLineSummary(only?.summary ?? only?.description, only?.id),
          order,
        };
      }
      const topic = this.config.topics.find((candidate) => candidate.name === family);
      const root = members.find((member) => member.id === family) ?? members[0];
      return {
        name: toConfiguredId(family, this.config),
        summary: this.oneLineSummary(topic?.description ?? root?.summary ?? root?.description),
        order,
      };
    });
    return rows.sort((a, b) =>
      compareInGroup({ id: a.name, groupOrder: a.order }, { id: b.name, groupOrder: b.order }),
    );
  }

  /**
   * The summary as `gh` prints it: the first clause of the summary or
   * description, with no trailing full stop. Built from the raw statics rather
   * than {@link summary} so a user theme's colour codes cannot end up inside
   * the clause; the theme is applied once the text is final.
   */
  private oneLineSummary(text: string | undefined, id?: string): string {
    const source = (id === undefined ? undefined : PLUGIN_SUMMARIES[id]) ?? text ?? "";
    const [clause = ""] = this.render(source).split(/[.:]\s|\n/, 1);
    return ux.colorize(this.config.theme?.commandSummary, clause.trim().replace(/\.$/, ""));
  }
}
