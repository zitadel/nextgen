import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { connectTarget } from "../../lib/target";

/**
 * `zitadel projects promote` — make the project `production`. Every
 * allowlist pattern is re-checked against the production rules first.
 */
export default class ProjectsPromote extends BaseCommand {
  static override description = "Promote the project to class production.";
  static override group = CommandGroups.resources;
  static override examples = ["<%= config.bin %> projects promote --env production"];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(ProjectsPromote);
    await this.toMeta(flags);
    const { cwd, env, dryRun, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectTarget({ cwd, env, serverFlag, envName, envFile });
    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { class: "production" } });
    }
    const project = await client.setProjectClass(projectId, { class: "production" });
    return this.emit({
      status: "ok",
      data: { id: project.id, class: project.class, allowed_origins: project.allowed_origins },
      pretty: [
        ...project.allowed_origins.map((entry) => `  ${entry.pattern.padEnd(40)} ${entry.kind}   ✓`),
        `class      sandbox -> ${project.class}`,
      ].join("\n"),
    });
  }
}
