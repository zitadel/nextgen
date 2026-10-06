import { Flags } from "@oclif/core";

import { BaseCommand, CommandGroups, nonBlankArg, type JsonEnvelope } from "../../lib/oclif";
import { connectTarget } from "../../lib/target";

/** `zitadel allowlist add` — add one pattern, and print the check it passed. */
export default class AllowlistAdd extends BaseCommand {
  static override description = "Add an allowed origin pattern to the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> allowlist add https://app.acme.com --kind primary",
    "<%= config.bin %> allowlist add 'https://*-acmeinc.vercel.app' --kind preview",
  ];
  static override args = {
    pattern: nonBlankArg({ required: true, description: "An origin, or a pattern with one `*` label." }),
  };
  static override flags = {
    kind: Flags.string({
      required: true,
      options: ["primary", "preview"],
      description: "primary admits requests; preview only bounds what a preview deploy may register.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(AllowlistAdd);
    await this.toMeta(flags);
    const { cwd, env, dryRun, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectTarget({ cwd, env, serverFlag, envName, envFile });
    const kind = flags.kind as "primary" | "preview";
    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { pattern: args.pattern, kind } });
    }
    const added = await client.addAllowedOrigin(projectId, { pattern: args.pattern, kind });
    const check = added.check;
    const lines = [
      check.status === "ok"
        ? `checked   ${check.message}  ✓`
        : `warning   ${check.code ?? "warning"}\n          ${check.message}`,
      kind === "preview"
        ? "added     the preview credential may now register URLs matching it"
        : "added     requests from this origin are served",
    ];
    return this.emit({ status: "ok", data: added, pretty: lines.join("\n") });
  }
}
