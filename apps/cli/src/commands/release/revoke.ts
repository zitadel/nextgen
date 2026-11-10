import { Args, Flags } from "@oclif/core";
import { z } from "zod";

import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { mutatedData } from "@/lib/oclif/envelope";
import { ReleaseService } from "@/lib/backend";
import { RevokeReleaseParams } from "@/lib/backend/schemas";
import { type Refused, taken } from "@/lib/oclif/flags";
import { Destructive } from "@/lib/oclif/destructive";
import { prose } from "@/lib/oclif/rendering";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";

/**
 * The release `release revoke` revokes. The schema is the API spec's own, so a value that is not one is
 * refused before anything is asked or called, and says what one looks like.
 */
const RELEASE_ID: Refused<string> = {
  schema: z.string().trim().pipe(RevokeReleaseParams.shape.release_id),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Find one with `zitadel release list`.",
    next: ["release list"],
    details: {
      argument: "{input}",
    },
  },
};

/** How many serving origins the refusal names; `--json` lists them all. */
const SERVED_NAMED = 3;

/**
 * A release an origin still serves. The server names each origin and the
 * deployment that pins the release there; `{served}` lists them, so the person
 * sees what to move off before the next step.
 */
export const RELEASE_IN_USE_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "Release {release_id} is still served by {served}.",
  hint: "Deploy another release with `zitadel deploy`, or roll back with `zitadel deployment rollback`, then revoke this release again.",
  next: ["deploy", "deployment rollback"],
  details: {
    release_id: "{release_id}",
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
export default class ReleaseRevoke extends Destructive(EnvironmentCommand) {
  static override description = "Revoke a release so its content is never served again.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> release revoke rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
    "<%= config.bin %> release revoke rel_01KX3RG8A7F0N9WD3P2E4YM5C1 --force",
  ];
  static override args = {
    release_id: Args.custom<string>({ parse: taken(RELEASE_ID) })({
      required: true,
      description: "The release to revoke.",
    }),
  };
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Revoke the release without the confirmation prompt. Required when non-interactive.",
    }),
  };

  protected async execute({ args }: Admitted<typeof ReleaseRevoke>): Promise<JsonEnvelope> {
    return this.emit(
      await this.confirmed({
        verb: "revoke",
        name: `revoke ${args.releaseId}`,
        message: `Revoke ${args.releaseId}? Its content can never be served again.`,
        preview: () => {
          return {
            status: "ok",
            data: { dry_run: true, release_id: args.releaseId },
            pretty: prose(`Would revoke ${args.releaseId}. Nothing was revoked (dry run).`),
          };
        },
        prepare: () => {
          return this.connect();
        },
        apply: async (consent, { client, projectId }) => {
          const releaseService = new ReleaseService(consent.unlock(client), projectId);
          const outcome = await releaseService.revoke(args.releaseId);
          if (outcome.outcome === "in-use") {
            const named = outcome.origins.slice(0, SERVED_NAMED).map((one) => {
              return `${one.origin} (deployment ${one.deployment_id})`;
            });
            const rest = outcome.origins.length - named.length;
            const served = (rest > 0 ? [...named, `${rest} more`] : named).join(", ");
            throw refusalError(
              RELEASE_IN_USE_REFUSAL,
              {
                release_id: args.releaseId,
                served,
                origins: outcome.origins,
              },
              (next) => {
                return this.suggest(next);
              },
            );
          }
          const { release } = outcome;
          return {
            status: "ok",
            data: {
              ...mutatedData({ release_id: release.id }, "revoked"),
              revoked_at: release.revoked_at,
            },
            pretty: prose(`Revoked ${release.id}`),
          };
        },
      }),
    );
  }
}
