import { BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { prose } from "@/lib/oclif/rendering";
import { addSkills, bundledSkills, CLAUDE_SKILLS_DIR, skillDirs } from "@/lib/skills/add";
import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * `zitadel skills add` — give the project's coding agents the Zitadel skills.
 *
 * The skills ship inside the CLI, so the ones added are those of the release
 * the user runs, which `setup` also pins the app's `@zitadel/*` packages to.
 * Adding them is this command's whole job, so it asks nothing; running it
 * again replaces them, which is how they follow a CLI update.
 */
export default class SkillsAdd extends BaseCommand {
  static override description =
    "Add the Zitadel agent skills to this project.\n\nAdds the skills of this CLI's version to .agents/skills, which most coding agents read, and to .claude/skills for Claude Code. Run it again after updating the CLI to replace them with the new version's.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 5;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --cwd my-app",
  ];

  static override meta = {
    resolveServer: false,
  };

  protected async execute(): Promise<JsonEnvelope> {
    const skills = await bundledSkills(this.config.root);
    const dirs = await skillDirs(this.cwd);
    if (!this.dryRun) {
      await addSkills({
        packageRoot: this.config.root,
        projectDir: this.cwd,
        skills,
        dirs,
      });
    }

    const title = `${this.dryRun ? "Would add" : "Added"} the ${skills.length} Zitadel agent skills of CLI ${this.cliVersion}${this.dryRun ? " (dry run)" : ""}`;
    const lines = [
      `${title} to:`,
      ...dirs.map((dir) => {
        return `  ${dir}${dir === CLAUDE_SKILLS_DIR ? "  (Claude Code)" : ""}`;
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
    });
  }
}
