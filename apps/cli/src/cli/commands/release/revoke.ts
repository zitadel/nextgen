import { Args } from "@oclif/core";
import { z } from "zod";

import { ReleaseService } from "@/lib/backend";
import { RevokeReleaseParams } from "@/lib/backend/schemas";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { mutatedData } from "@/cli/core/envelope";
import { type Refused, taken } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { type Suggestion, WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { RemoveCommand } from "@/cli/commands/bases";

/**
 * The release `release revoke` revokes. The schema is the API spec's own, so a value that is not one is
 * refused before anything is asked or called, and says what one looks like.
 */
const RELEASE_ID: Refused<string> = {
  schema: z.string().trim().pipe(RevokeReleaseParams.shape.release_id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "List the releases to find one.",
    next: [{ id: "release:list" }],
    details: {
      argument: "{input}",
    },
  },
};

/**
 * How many serving origins the refusal names in its hint, and how many previews
 * it suggests removing.
 *
 * @remarks
 * The refusal's details list every serving origin, so nothing is lost. Once the
 * named previews are removed, revoking again suggests the next ones.
 */
const SERVED_NAMED = 3;

/**
 * How a release an origin still serves is refused: the origins that serve it,
 * and what frees them. The server names the origins; the steps are the CLI's.
 */
const RELEASE_IN_USE_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "release: still served by an origin",
  hint: "Served by {served}. Revoke it again after you {steps}.",
  next: ["{next}"],
  details: {
    release_id: "{release}",
    origins: "{origins}",
  },
};

/**
 * `zitadel release revoke <release_id>` — mark a release so its content is
 * never served again.
 *
 * A release an origin still serves cannot be revoked; deploy another release
 * there or roll it back first. Revoking is idempotent and cannot be undone.
 */
export default class ReleaseRevoke extends RemoveCommand(
  "Revoke the release without the confirmation prompt. Required when non-interactive.",
) {
  static override description = "Revoke a release so its content is never served again.";
  static override group = CommandGroups.releases;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> release revoke rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
    "<%= config.bin %> release revoke rel_01KX3RG8A7F0N9WD3P2E4YM5C1 --force",
  ];
  static override args = {
    release_id: Args.custom<string>({
      parse: taken(RELEASE_ID),
    })({
      required: true,
      description: "The release to revoke.",
    }),
  };
  /**
   * Says what revoking the release would do, without connecting or revoking.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ args }: Admitted<typeof ReleaseRevoke>): Promise<CommandResult> {
    const result = dryRunResult({
      verb: "revoke",
      topic: "release",
      id: args.releaseId,
      next: await this.realRun({ force: true }),
    });

    return {
      ...result,
      data: {
        ...(result.data as object),
        release_id: args.releaseId,
      },
    };
  }

  /**
   * Revokes the release, once the person has agreed or forced it.
   *
   * @param input - The flags and arguments of the run.
   * @returns The envelope of the revocation.
   */
  protected async apply({ args }: Admitted<typeof ReleaseRevoke>): Promise<CommandResult> {
    return await this.confirmed({
      verb: "revoke",
      name: `revoke ${args.releaseId}`,
      message: async () => {
        return `Revoke ${args.releaseId} in ${await this.projectOnServer()} so its content can never be served again?`;
      },
      apply: async (consent) => {
        const releaseService = await this.service(ReleaseService, consent);
        const outcome = await releaseService.revoke(args.releaseId);
        if (outcome.outcome === "in-use") {
          const primaries = outcome.origins.filter((origin) => {
            return origin.kind === "primary";
          });
          const previews = outcome.origins.filter((origin) => {
            return origin.kind === "preview";
          });
          const steps = [
            ...(primaries.length > 0 ? ["put another release live on each primary origin"] : []),
            ...(previews.length > 0 ? ["remove each preview"] : []),
          ];
          const next: Suggestion[] = [
            ...(primaries.length > 0
              ? [
                  {
                    id: "deploy",
                    flags: { message: WHAT_CHANGED },
                  } satisfies Suggestion,
                  { id: "deployment:rollback" } satisfies Suggestion,
                ]
              : []),
            ...previews.slice(0, SERVED_NAMED).map((preview) => {
              return {
                id: "preview:rm",
                args: { url: preview.origin },
              } satisfies Suggestion;
            }),
          ];

          const named = outcome.origins.slice(0, SERVED_NAMED).map((origin) => {
            return `${origin.origin} (${origin.kind}, ${origin.deployment_id})`;
          });
          const rest = outcome.origins.length - named.length;
          const served = rest > 0 ? `${named.join("; ")}; and ${rest} more` : named.join("; ");

          throw refusalError(
            RELEASE_IN_USE_REFUSAL,
            {
              served,
              steps: steps.join(" and "),
              release: args.releaseId,
              origins: outcome.origins,
            },
            { next },
          );
        }
        const { release } = outcome;
        const title = `Revoked ${escapeControlCharacters(release.id)}`;

        return {
          status: "ok",
          data: {
            title,
            ...mutatedData({ release_id: release.id }, "revoked"),
            revoked_at: release.revoked_at,
          },
          summary: {
            title,
            sections: [],
          },
        };
      },
    });
  }
}
