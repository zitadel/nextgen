import { CommandGroups } from "@/cli/commands/groups";
import type { CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { prose } from "@/lib/oclif/rendering";
import { Skills } from "@/lib/skills";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Previewable } from "@/cli/core/previewable";
import { BaseCommand } from "@/cli/core";

/**
 * `zitadel skills add` — give the project's coding agents the Zitadel skills.
 *
 * The skills ship inside the CLI, so the ones added are those of the release
 * the user runs, which `setup` also pins the app's `@zitadel/*` packages to.
 * Adding them is this command's whole job, so it asks nothing; running it
 * again replaces them, which is how they follow a CLI update.
 */
export default class SkillsAdd extends Previewable(BaseCommand) {
  static override description =
    "Add the Zitadel agent skills to this project.\n\nAdds the skills of this CLI's version to .agents/skills, which most coding agents read, and to .claude/skills for Claude Code. Run it again after updating the CLI to replace them with the new version's.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> skills add",
    "<%= config.bin %> skills add --cwd my-app",
  ];

  /**
   * Says which skills would be added and where, without adding any.
   *
   * @returns The envelope of the dry run.
   */
  protected async preview(): Promise<CommandResult> {
    const skills = await Skills.bundled(this.config.root);
    const dirs = await Skills.dirs(this.cwd);
    const result = dryRunResult({
      verb: "add",
      topic: "skills",
      noun: `the ${skills.length} Zitadel agent skills of CLI ${this.cliVersion}`,
      next: await this.realRun(),
    });
    const lines = [
      result.summary.title,
      "Would add them to:",
      ...dirs.map((dir) => {
        return `  ${dir}${dir === Skills.CLAUDE_DIR ? "  (Claude Code)" : ""}`;
      }),
      "Run this again after updating the CLI to keep them in step with it.",
    ];

    return {
      ...result,
      data: {
        ...(result.data as object),
        skills,
        directories: dirs,
      },
      pretty: prose(lines.join("\n")),
      summary: {
        ...result.summary,
        lines: lines.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
    };
  }

  /**
   * Adds the bundled skills to the project's skill directories.
   *
   * @returns The envelope of the run.
   */
  protected async apply(): Promise<CommandResult> {
    const skills = await Skills.bundled(this.config.root);
    const dirs = await Skills.dirs(this.cwd);
    await Skills.add({
      packageRoot: this.config.root,
      projectDir: this.cwd,
      skills,
      dirs,
    });

    const title = `Added the ${skills.length} Zitadel agent skills of CLI ${this.cliVersion}`;
    const lines = [
      title,
      "Added them to:",
      ...dirs.map((dir) => {
        return `  ${dir}${dir === Skills.CLAUDE_DIR ? "  (Claude Code)" : ""}`;
      }),
      "Run this again after updating the CLI to keep them in step with it.",
    ];

    return {
      status: "ok",
      data: {
        title,
        skills,
        directories: dirs,
      },
      pretty: prose(lines.join("\n")),
      summary: {
        title,
        sections: [],
        lines: lines.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
    };
  }
}
