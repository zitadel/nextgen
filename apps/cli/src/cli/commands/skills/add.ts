import { CommandGroups } from "@/cli/commands/groups";
import { BaseCommand, type JsonEnvelope } from "@/lib/oclif";
import { prose } from "@/lib/oclif/rendering";
import { Skills } from "@/lib/skills";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { ServerCommand } from "@/cli/commands/server-command";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * `zitadel skills add` — give the project's coding agents the Zitadel skills.
 *
 * The skills ship inside the CLI, so the ones added are those of the release
 * the user runs, which `setup` also pins the app's `@zitadel/*` packages to.
 * Adding them is this command's whole job, so it asks nothing; running it
 * again replaces them, which is how they follow a CLI update.
 */
export default class SkillsAdd extends Telemetered(ServerCommand(BaseCommand)) {
  static override description =
    "Add the Zitadel agent skills to this project.\n\nAdds the skills of this CLI's version to .agents/skills, which most coding agents read, and to .claude/skills for Claude Code. Run it again after updating the CLI to replace them with the new version's.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --cwd my-app",
  ];

  /**
   * Legacy: `--server` is accepted and ignored, so the run names no server.
   *
   * @returns No server.
   */
  protected override async resolveServer(): Promise<string> {
    return "";
  }

  protected async execute(): Promise<JsonEnvelope> {
    const skills = await Skills.bundled(this.config.root);
    const dirs = await Skills.dirs(this.cwd);
    if (!this.dryRun) {
      await Skills.add({
        packageRoot: this.config.root,
        projectDir: this.cwd,
        skills,
        dirs,
      });
    }

    const title = `${this.dryRun ? "Would add" : "Added"} the ${skills.length} Zitadel agent skills of CLI ${this.cliVersion}${this.dryRun ? " (dry run)" : ""}`;
    const lines = [
      title,
      this.dryRun ? "Would add them to:" : "Added them to:",
      ...dirs.map((dir) => {
        return `  ${dir}${dir === Skills.CLAUDE_DIR ? "  (Claude Code)" : ""}`;
      }),
      "Run this again after updating the CLI to keep them in step with it.",
    ];

    return this.emit({
      status: "ok",
      data: {
        title,
        ...(this.dryRun ? { dry_run: true } : {}),
        skills,
        directories: dirs,
      },
      pretty: prose(lines.join("\n")),
      summary: {
        title: escapeControlCharacters(title),
        sections: [],
        lines: lines.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
      ...(this.dryRun ? { next: { commands: [await this.realRun()] } } : {}),
    });
  }
}
