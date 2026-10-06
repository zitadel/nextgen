import { normalizeOrigin } from "../../lib/deployments";
import { BaseCommand, CommandGroups, nonBlankArg, type JsonEnvelope } from "../../lib/oclif";
import { connectTarget } from "../../lib/target";

/**
 * `zitadel preview rm` — retire one preview URL early. Its deployment records
 * are kept; only the row that admitted requests from it goes.
 */
export default class PreviewRm extends BaseCommand {
  static override description = "Retire a preview URL; its deployment records are kept.";
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
    const { client, projectId } = await connectTarget({ cwd, env, serverFlag, envName, envFile });
    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { origin } });
    }
    await client.removeOrigin({ origin }, { project_id: projectId });
    return this.emit({
      status: "ok",
      data: { origin, removed: true },
      pretty: "removed. the URL stops being served; its deployment records are kept.",
    });
  }
}
