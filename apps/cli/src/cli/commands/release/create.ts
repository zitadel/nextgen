import { Flags } from "@oclif/core";
import { z } from "zod";

import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { type Refused, reads } from "@/cli/core/flags";
import { MESSAGE_MAX_LENGTH, messageTooLong, Publisher } from "@/lib/publish";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { warnings } from "@/lib/ui";
import { ChangeCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * What `-m/--message` records. It refuses a blank message, which would record
 * nothing, and one longer than the server records, which the server would
 * reject later. `messageTooLong` counts code points, as the server does, so
 * the length is its call and not the schema's. The message is trimmed.
 */
const MESSAGE = {
  schema: z
    .string()
    .trim()
    .min(1, "the value is empty")
    .refine((message) => {
      return !messageTooLong(message);
    }, `the message is longer than ${MESSAGE_MAX_LENGTH} characters`),
  refusal: {
    message: "{problem}",
    hint: "Pass a shorter summary with -m.",
    details: {
      argument: "--message",
    },
  },
} as const satisfies Refused<string>;

/**
 * `zitadel release create` — build a release from .zitadel/ without deploying it.
 */
export default class ReleaseCreate extends Telemetered(ChangeCommand) {
  static override description = "Build a release from .zitadel/ without deploying it.";
  static override group = CommandGroups.releases;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> release create",
    "<%= config.bin %> release create -m 'add phone_number to human-user'",
  ];
  static override flags = {
    message: Flags.custom<string>({
      parse: reads(MESSAGE),
    })({
      char: "m",
      description: "A short summary of what this release changes.",
    }),
  };

  /**
   * Validates the bundle the same way, then stops before the release is posted
   * so nothing is written server-side.
   *
   * @returns The envelope of the dry run.
   */
  protected async preview(): Promise<CommandResult> {
    const { prepared, diff } = await this.prepared(true);
    const result = dryRunResult({
      verb: "create",
      topic: "release",
      next: await this.realRun(),
    });

    return {
      ...result,
      data: { ...(result.data as object), resources: prepared.resourceCount },
      summary: {
        ...result.summary,
        lines: [
          `Validated ${prepared.resourceCount} ${new Intl.PluralRules("en").select(prepared.resourceCount) === "one" ? "resource" : "resources"}`,
          ...diff,
        ],
      },
    };
  }

  /**
   * Builds the release and posts it.
   *
   * @param input - The flags the command accepts.
   * @returns The envelope of the run.
   */
  protected async apply({ flags }: Admitted<typeof ReleaseCreate>): Promise<CommandResult> {
    const { publisher, prepared, diff } = await this.prepared(false);

    const release = await publisher.createRelease({
      prepared,
      message: flags.message,
    });

    const title = `Created ${escapeControlCharacters(release.id)}`;

    return {
      status: "ok",
      data: {
        title,
        release_id: release.id,
        content_hash: release.content_hash,
        resources: prepared.resourceCount,
      },
      summary: {
        title,
        sections: [],
        lines: diff,
      },
      next: {
        commands: [
          this.suggest({
            id: "deployment:create",
            flags: { release: release.id },
          }),
        ],
      },
    };
  }

  /**
   * Builds what the release would hold and says so: the IdP connections sync
   * before the build, as `deploy` does, because a release names its connections
   * by slug and the server refuses to build one that names a slug the project
   * does not hold yet. What it found is said now, before the steps that can
   * fail, and kept for a result that a pipe reads.
   *
   * @param dryRun - Whether the release is only validated, so nothing is written server-side.
   * @returns The publisher, what it prepared, and the diff the result carries.
   */
  private async prepared(dryRun: boolean) {
    const publisher = await this.service(Publisher);
    const prepared = await publisher.prepare({
      cwd: this.cwd,
      env: this.env,
      mode: "deploy",
      dryRun,
      compare: false,
    });
    for (const warning of prepared.warnings) {
      warnings.report(warning);
    }
    const diff = this.narrate(prepared.notices);

    return {
      publisher,
      prepared,
      diff,
    };
  }
}
