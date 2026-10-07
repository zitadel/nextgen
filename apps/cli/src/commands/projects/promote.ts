import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { connectEnvironment } from "../../lib/environment";

/**
 * `zitadel projects promote` — put the project in production mode. Every
 * origin pattern is re-checked against the production rules first.
 */
export default class ProjectsPromote extends BaseCommand {
  static override description = "Promote the project to production mode.";
  static override group = CommandGroups.resources;
  static override examples = ["<%= config.bin %> projects promote --env production"];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(ProjectsPromote);
    await this.toMeta(flags);
    const { cwd, env, dryRun, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectEnvironment({ cwd, env, serverFlag, envName, envFile });
    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { mode: "production" } });
    }
    const project = await client.setProjectMode(projectId, { mode: "production" });
    return this.emit({
      status: "ok",
      data: { id: project.id, mode: project.mode, origins: project.origins },
      pretty: [
        ...project.origins.map((entry) => `  ${entry.pattern.padEnd(40)} ${entry.kind}   ✓`),
        `mode       sandbox -> ${project.mode}`,
      ].join("\n"),
    });
  }
}
