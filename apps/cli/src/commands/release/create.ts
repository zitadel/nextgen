import { Cmd } from "@/lib/cmd";
import { Flags } from "@oclif/core";
import { z } from "zod";

import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { reads, type Refused } from "@/lib/oclif/flags";
import { Publisher } from "@/lib/publish";
import { MESSAGE_MAX_LENGTH, messageTooLong } from "@/lib/publish";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";

/**
 * What `-m/--message` records. It refuses a blank message, which would record
 * nothing, and one longer than the server records, which the server would
 * reject later. `messageTooLong` counts code points, as the server does, so
 * the length is its call and not the schema's. The message is trimmed.
 */
const MESSAGE: Refused<string> = {
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
};

/**
 * `zitadel release create` — build a release from .zitadel/ without deploying it.
 */
export default class ReleaseCreate extends EnvironmentCommand {
  static override description = "Build a release from .zitadel/ without deploying it.";
  static override group = CommandGroups.configuration;

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

  protected async execute({ flags }: Admitted<typeof ReleaseCreate>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();
    const publisher = new Publisher(client, projectId);
    // The IdP connections sync before the build, as `deploy` does: a release
    // names its connections by slug, and the server refuses to build one
    // that names a slug the project does not hold yet.
    const prepared = await publisher.prepare({
      cwd: this.cwd,
      env: this.env,
      mode: "deploy",
      dryRun: this.dryRun,
      compare: false,
      json: this.isJson,
      color: this.isColored,
      suggest: (args) => {
        return this.suggest(args);
      },
    });
    for (const warning of prepared.warnings) {
      reportWarning(warning);
    }
    this.narrate(prepared.notices);
    // `release create` carries the same no-mutation promise every command does
    // under `--dry-run`: validate the bundle the same way, then stop before the
    // release is posted so nothing is written server-side.
    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          resources: prepared.resourceCount,
        },
        summary: {
          title: `Validated ${prepared.resourceCount} ${new Intl.PluralRules("en").select(prepared.resourceCount) === "one" ? "resource" : "resources"} and created no release (dry run)`,
          sections: [],
        },
      });
    }

    const release = await publisher.createRelease({
      prepared,
      message: flags.message,
    });

    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        content_hash: release.content_hash,
        resources: prepared.resourceCount,
      },
      summary: {
        title: `Created ${escapeControlCharacters(release.id)}`,
        sections: [],
      },
      next: { commands: [this.suggest(`deployment create --release ${Cmd.quote(release.id)}`)] },
    });
  }
}
