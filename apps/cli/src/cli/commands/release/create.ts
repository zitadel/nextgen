import { Flags } from "@oclif/core";
import { z } from "zod";

import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { type Refused, reads } from "@/cli/core/flags";
import { BackendReleaseContentRevokedError } from "@/lib/backend";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import {
  MESSAGE_MAX_LENGTH,
  messageTooLong,
  Publisher,
  PublishConfigInvalidError,
  PublishConnectionSecretLiteralError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
  PublishConnectionVariableSharedError,
} from "@/lib/publish";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { warnings } from "@/lib/ui";
import { ChangeCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/** How a configuration with errors is refused. */
const CONFIG_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix the files named above and rerun; no changes were made.",
} as const satisfies Refusal;

/** How a release is refused when its content builds back to a revoked release. */
const RELEASE_REVOKED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
  details: {
    release_id: "{release_id}",
    content_hash: "{content_hash}",
  },
} as const satisfies Refusal;

/** How a connection that holds its secret itself is refused. */
const SECRET_LITERAL_REFUSAL = {
  message: "{message}",
  hint: 'Publish a secret with the command below and reference it as "${{ NAME }}".',
  next: [
    {
      id: "variable:set",
      args: {
        name: "NAME",
      },
      flags: {
        secret: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How a connection whose client id and secret name one variable is refused. */
const VARIABLE_SHARED_REFUSAL = {
  message: "{message}",
  hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
} as const satisfies Refusal;

/** How a connection that names a variable the project does not have is refused. */
const VARIABLE_MISSING_REFUSAL = {
  code: "E_CREDENTIAL_MISSING",
  message: "{message}",
  hint: "Publish it with the command below, then deploy again.",
  next: ["{set}"],
} as const satisfies Refusal;

/** How a connection that names a variable of the wrong kind is refused. */
const VARIABLE_KIND_REFUSAL = {
  message: "{message}",
  hint: "{hint}",
  next: ["{set}"],
} as const satisfies Refusal;

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

    try {
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
    } catch (error) {
      if (error instanceof BackendReleaseContentRevokedError) {
        throw refusalError(RELEASE_REVOKED_REFUSAL, {
          ...error,
          message: error.message,
          release_id: error.releaseId,
          content_hash: error.contentHash,
        });
      }
      throw error;
    }
  }

  /**
   * Prepares what is published, refusing a configuration that cannot be
   * published and saying how to fix it.
   *
   * @param publisher - The publisher.
   * @param input - What to prepare.
   * @returns What was prepared.
   * @throws {@link ZitadelError} The refusal for the condition publishing stopped on; an
   *   error nobody anticipated is thrown as it was.
   */
  private async prepare(publisher: Publisher, input: Parameters<Publisher["prepare"]>[0]) {
    try {
      return await publisher.prepare(input);
    } catch (error) {
      if (error instanceof PublishConnectionSecretLiteralError) {
        throw refusalError(SECRET_LITERAL_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof PublishConnectionVariableSharedError) {
        throw refusalError(VARIABLE_SHARED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof PublishConnectionVariableMissingError) {
        throw refusalError(
          VARIABLE_MISSING_REFUSAL,
          {
            ...error,
            message: error.message,
          },
          {
            set: {
              id: "variable:set",
              args: {
                name: error.variable,
              },
              flags: {
                secret: error.secret,
                preview: input.mode === "preview",
              },
            },
          },
        );
      }
      if (error instanceof PublishConnectionVariableKindError) {
        throw refusalError(
          VARIABLE_KIND_REFUSAL,
          {
            ...error,
            message: error.message,
            hint: error.secret
              ? "The client secret must be a secret variable: publish it with the command below."
              : "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
          },
          {
            set: {
              id: "variable:set",
              args: {
                name: error.variable,
              },
              flags: {
                secret: error.secret,
                preview: input.mode === "preview",
              },
            },
          },
        );
      }
      if (error instanceof PublishConfigInvalidError) {
        throw refusalError(CONFIG_INVALID_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
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
    const prepared = await this.prepare(publisher, {
      cwd: this.cwd,
      env: this.env,
      mode: "deploy",
      dryRun,
      compare: false,
    });
    for (const warning of prepared.warnings) {
      warnings.report(warning);
    }
    this.narrate(prepared.notices);
    const diff = prepared.notices.flatMap((notice, at) => {
      return [...(at === 0 ? [] : [""]), ...notice.replace(/\n+$/, "").split("\n")];
    });

    return {
      publisher,
      prepared,
      diff,
    };
  }
}
