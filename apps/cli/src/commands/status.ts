import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import {
  hasZitadelSecret,
  readDevelopmentIssuer,
  readZitadelConfig,
  readZitadelSecret,
} from "../lib/project";

/**
 * `zitadel status` — summarize the local project state.
 *
 * Reads `zitadel.json` and its secret. A present config with a missing secret
 * is treated as an "orphaned" install (returned as skipped with recovery
 * commands) rather than an error, so status stays informational and safe to
 * run on partial or broken setups.
 */
export default class Status extends BaseCommand {
  static override description = "Summarize the local project state.";

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Status);
    await this.toMeta(flags);
    const { cwd, source } = this.meta;

    const config = await readZitadelConfig(cwd);

    if (!(await hasZitadelSecret(cwd))) {
      return this.emit({
        status: "skipped",
        reason: "orphaned-config",
        data: {
          project_id: typeof config.project === "string" ? config.project : undefined,
          lifecycle: "orphaned-config",
          message: "zitadel.json exists but .zitadel/secret is missing.",
        },
        nextCommands: ["zitadel setup --force", "zitadel doctor --fix"],
      });
    }

    const secret = await readZitadelSecret(cwd);
    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel project detected.",
        project: {
          project_id: String(config.project ?? secret.project_id ?? ""),
          lifecycle: secret.lifecycle ?? "unclaimed",
          issuer: readDevelopmentIssuer(config),
        },
        server: source,
        next_actions: ["Run `zitadel doctor`.", "Run `zitadel apply` after config changes."],
        next_commands: ["zitadel doctor", "zitadel apply"],
      },
    });
  }
}
