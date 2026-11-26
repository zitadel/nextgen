import { Flags } from "@oclif/core";

import { OriginService } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, type CommandResult, nonBlankArg } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { relatedFlags } from "@/lib/suggestion/relations";
import { ChangeCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

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
export default class OriginAdd extends Telemetered(ChangeCommand) {
  static override description = "Add an origin pattern to the project.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 3;

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
  static override flags = relatedFlags(
    {
      kind: Flags.option({
        description: "What the pattern is for.",
        options: ORIGIN_KINDS,
      })(),
    },
    { kind: { required: true } },
  );

  /**
   * Says which origin pattern would be added, without adding it. A dry run
   * makes no request, so it answers before the connection, the order the
   * resource commands' `create` uses, which keeps `--dry-run --non-interactive`
   * usable.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ args, flags }: Admitted<typeof OriginAdd>): Promise<CommandResult> {
    return dryRunResult({
      verb: "add",
      topic: "origin",
      id: args.pattern,
      body: { kind: flags.kind },
      next: await this.realRun(),
    });
  }

  /**
   * Adds the origin pattern.
   *
   * @param input - The flags and arguments of the run.
   * @returns The run's envelope.
   */
  protected async apply({ args, flags }: Admitted<typeof OriginAdd>): Promise<CommandResult> {
    const originService = await this.service(OriginService);
    const added = await originService.add(args.pattern, flags.kind);

    const title = `Added ${escapeControlCharacters(added.pattern)} (${escapeControlCharacters(added.kind)})`;

    return {
      status: "ok",
      data: {
        title,
        pattern: added.pattern,
        kind: added.kind,
      },
      summary: {
        title,
        sections: [],
      },
      next: { commands: [this.suggest({ id: "origin:list" })] },
    };
  }
}
