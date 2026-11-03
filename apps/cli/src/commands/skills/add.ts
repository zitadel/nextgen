import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { addSkills, bundledSkills, CLAUDE_SKILLS_DIR, skillDirs } from "../../lib/skills/add";

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

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(SkillsAdd);
    // The skills are in the package: nothing to ask a server.
    await this.toMeta(flags, { resolveServer: false });

    const skills = await bundledSkills(this.config.root);
    const dirs = await skillDirs(this.meta.cwd);
    if (!this.meta.dryRun) {
      await addSkills({
        packageRoot: this.config.root,
        projectDir: this.meta.cwd,
        skills,
        dirs,
      });
    }

    return this.emit({
      status: "ok",
      data: {
        title: this.meta.dryRun ? "Zitadel agent skills to add." : "Zitadel agent skills added.",
        skills,
        directories: dirs,
        ...(this.meta.dryRun ? { dry_run: true } : {}),
      },
      pretty: [
        `${this.meta.dryRun ? "Would add" : "Added"} the ${skills.length} Zitadel agent skills of CLI ${this.meta.cliVersion} to:`,
        ...dirs.map((dir) => `  ${dir}${dir === CLAUDE_SKILLS_DIR ? "  (Claude Code)" : ""}`),
        "Run this again after updating the CLI to keep them in step with it.",
      ].join("\n"),
    });
  }
}
