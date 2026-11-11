import { Flags } from "@oclif/core";

import { OriginService } from "@/lib/backend";
import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "@/lib/oclif";
import { dryRunResult } from "@/lib/oclif/crud/shared";
import { escapeControlCharacters } from "@/lib/terminal-text";

/** The two kinds an origin pattern can be, as the `--kind` flag accepts them. */
const ORIGIN_KINDS = ["primary", "preview"] as const;

/**
 * `zitadel origin add <pattern> --kind primary|preview` — add one origin
 * pattern to the project.
 *
 * The CLI sends the pattern as it is and prints what the server stored, or the
 * server's rejection in words: a primary pattern must be an exact URL, and a
 * preview wildcard on a shared host needs a literal label of your own. The
 * check the pattern passed stands in for the review a committed list would have
 * had, which is why this is a deliberate command and never a side effect of a
 * deploy.
 */
export default class OriginAdd extends EnvironmentCommand {
  static override description = "Add an origin pattern to the project.";
  static override group = CommandGroups.configuration;

  static override examples = [
    "<%= config.bin %> origin add https://app.acme.com --kind primary",
    "<%= config.bin %> origin add 'https://*-acme.vercel.app' --kind preview",
  ];
  static override args = {
    pattern: nonBlankArg({
      required: true,
      description: "The origin pattern to add.",
    }),
  };
  static override flags = {
    kind: Flags.option({
      description: "What the pattern is for.",
      options: ORIGIN_KINDS,
      required: true,
    })(),
  };

  protected async execute({ args, flags }: Admitted<typeof OriginAdd>): Promise<JsonEnvelope> {
    // A dry run makes no request, so it answers before the connection — the
    // order the resource commands' `create` uses, which keeps
    // `--dry-run --non-interactive` usable.
    if (this.dryRun) {
      return this.emit(
        dryRunResult({
          verb: "add",
          topic: "origin",
          id: args.pattern,
          body: { kind: flags.kind },
        }),
      );
    }

    const { client, projectId } = await this.connect();

    const originService = new OriginService(client, projectId);
    const added = await originService.add(args.pattern, flags.kind);

    return this.emit({
      status: "ok",
      data: {
        pattern: added.pattern,
        kind: added.kind,
      },
      summary: {
        title: `Added ${escapeControlCharacters(added.pattern)} (${escapeControlCharacters(added.kind)})`,
        sections: [],
      },
      next: {
        commands: [this.suggest("origin list")],
      },
    });
  }
}
