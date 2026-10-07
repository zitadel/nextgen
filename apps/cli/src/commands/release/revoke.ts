import { connectEnvironment } from "../../lib/environment";
import { BaseCommand, CommandGroups, nonBlankArg, type JsonEnvelope } from "../../lib/oclif";

/**
 * `zitadel release revoke` — the operator's hard stop: the release is refused
 * on every path, including a client that pins it.
 */
export default class ReleaseRevoke extends BaseCommand {
  static override description = "Revoke a release so nothing serves it, pinned or not.";
  static override group = CommandGroups.configuration;
  static override examples = ["<%= config.bin %> release revoke rel_01KX3RG8A7F0N9WD3P2E4YM5C1"];
  static override args = {
    id: nonBlankArg({ required: true, description: "The release id." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(ReleaseRevoke);
    await this.toMeta(flags);
    const { cwd, env, dryRun, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectEnvironment({ cwd, env, serverFlag, envName, envFile });
    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { id: args.id } });
    }
    const release = await client.revokeRelease(args.id, { project_id: projectId });
    return this.emit({
      status: "ok",
      data: { id: release.id, revoked_at: release.revoked_at },
      pretty: `revoked ${release.id}. targets serving it answer rel.revoked until something else is deployed there.`,
    });
  }
}
