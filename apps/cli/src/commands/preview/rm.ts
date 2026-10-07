import { normalizeOrigin } from "../../lib/deployments";
import { connectEnvironment } from "../../lib/environment";
import { BaseCommand, CommandGroups, nonBlankArg, type JsonEnvelope } from "../../lib/oclif";

/**
 * `zitadel preview rm` — retire one preview URL early. Its deployments are
 * kept; only the preview that admitted requests from it goes.
 */
export default class PreviewRm extends BaseCommand {
  static override description = "Retire a preview URL; its deployments are kept.";
  static override group = CommandGroups.configuration;
  static override examples = ["<%= config.bin %> preview rm https://acme-git-sso-acmeinc.vercel.app"];
  static override args = {
    url: nonBlankArg({ required: true, description: "The preview URL to retire." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(PreviewRm);
    await this.toMeta(flags);
    const { cwd, env, dryRun, serverFlag, envName, envFile } = this.meta;
    const origin = normalizeOrigin(args.url);
    const { client, projectId } = await connectEnvironment({ cwd, env, serverFlag, envName, envFile });
    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { origin } });
    }
    await client.removePreview({ origin }, { project_id: projectId });
    return this.emit({
      status: "ok",
      data: { origin, removed: true },
      pretty: "removed. the URL stops being served; its deployments are kept.",
    });
  }
}
