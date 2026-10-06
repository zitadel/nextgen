import { BaseCommand, CommandGroups, nonBlankArg, type JsonEnvelope } from "../../lib/oclif";
import { connectTarget } from "../../lib/target";

/** `zitadel allowlist rm` — remove one pattern. Live previews and the history stay. */
export default class AllowlistRm extends BaseCommand {
  static override description = "Remove an allowed origin pattern from the project.";
  static override group = CommandGroups.configuration;
  static override examples = ["<%= config.bin %> allowlist rm https://old.acme.com"];
  static override args = {
    pattern: nonBlankArg({ required: true, description: "The pattern to remove, exactly as listed." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(AllowlistRm);
    await this.toMeta(flags);
    const { cwd, env, dryRun, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectTarget({ cwd, env, serverFlag, envName, envFile });
    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { pattern: args.pattern } });
    }
    await client.removeAllowedOrigin(projectId, { pattern: args.pattern });
    return this.emit({
      status: "ok",
      data: { pattern: args.pattern, removed: true },
      pretty: `removed ${args.pattern}`,
    });
  }
}
