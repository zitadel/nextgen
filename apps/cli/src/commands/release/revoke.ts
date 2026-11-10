import { Args, Flags } from "@oclif/core";
import { z } from "zod";

import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { mutatedData } from "@/lib/oclif/envelope";
import { ReleaseService } from "@/lib/backend";
import { Cmd } from "@/lib/cmd";
import type { ServingOrigin } from "@/lib/backend/services/release";
import { RevokeReleaseParams } from "@/lib/backend/schemas";
import { type Refused, taken } from "@/lib/oclif/flags";
import { Destructive } from "@/lib/oclif/destructive";
import { prose } from "@/lib/oclif/rendering";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { DEPLOY_ARGS } from "@/lib/suggestion";

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

/** How a release an origin still serves is refused: each origin, and the deployment that pins it. */
const IN_USE_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "{release} is still served by {served}",
  hint: "{steps}, then revoke it.",
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
          const revoked = await releaseService.revoke(args.releaseId);
          if (revoked.outcome === "in-use") {
            const served = revoked.origins.map((one) => {
              return `${one.origin} (${one.deployment_id})`;
            });
            const { steps, next } = freeing(revoked.origins);
            throw refusalError(
              IN_USE_REFUSAL,
              {
                release: args.releaseId,
                served: served.length > 0 ? served.join(", ") : "an origin",
                origins: revoked.origins,
                steps,
                next,
              },
              (command) => {
                return this.suggest(command);
              },
            );
          }
          const { release } = revoked;
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

/**
 * What frees the origins that serve a release: a preview is removed, while a
 * primary origin takes another deploy or a rollback. An origin whose kind could
 * not be read is treated as primary, the steps that apply to most projects.
 */
function freeing(origins: readonly ServingOrigin[]): { steps: string; next: string[] } {
  const previews = origins.filter((one) => {
    return one.kind === "preview";
  });
  const primary = previews.length < origins.length || origins.length === 0;
  const remove = previews.length === 1 ? "Remove the preview" : "Remove the previews";
  const steps =
    previews.length === 0
      ? "Deploy another release to the primary origins, or roll the deployment back"
      : primary
        ? `${remove}, and deploy another release to the primary origins or roll the deployment back`
        : remove;
  return {
    steps,
    next: [
      ...previews.map((one) => {
        return Cmd.of(["preview", "rm", one.origin]).toString();
      }),
      ...(primary ? [DEPLOY_ARGS, "deployment rollback"] : []),
    ],
  };
}
