import { Args, Flags } from "@oclif/core";
import { z } from "zod";

import { ReleaseInUseError, ReleaseService } from "@/lib/backend";
import { RevokeReleaseParams } from "@/lib/backend/schemas";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { type Suggestion, WHAT_CHANGED } from "@/lib/suggestion";
import { Destructive } from "@/lib/oclif/destructive";
import { mutatedData } from "@/lib/oclif/envelope";
import { type Refused, taken } from "@/lib/oclif/flags";

import { escapeControlCharacters } from "@/lib/terminal-text";

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
 * How a release an origin still serves is refused: the origins that serve it,
 * and what frees them. The server names the origins; the steps are the CLI's.
 */
const RELEASE_IN_USE_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "release: still served by an origin",
  hint: "Served by {served}. Revoke it again after you {steps}.",
  next: ["{next}"],
  details: "{details}",
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
    release_id: Args.custom<string>({
      parse: taken(RELEASE_ID),
    })({
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
        message: async () => {
          const { projectId, server } = await this.connect();
          return `Revoke ${args.releaseId} in project ${projectId} on ${server.replace(/^https?:\/\//, "")} so its content can never be served again?`;
        },
        preview: () => {
          const title = `Would revoke ${escapeControlCharacters(args.releaseId)} (dry run)`;

          return {
            status: "ok",
            data: {
              dry_run: true,
              title,
              release_id: args.releaseId,
            },
            summary: {
              title,
              sections: [],
            },
            next: {
              commands: [
                this.suggest({
                  id: "release:revoke",
                  args: { releaseId: args.releaseId },
                  flags: { force: true },
                }),
              ],
            },
          };
        },
        prepare: () => {
          return this.connect();
        },
        apply: async (consent, { client, projectId }) => {
          const releaseService = new ReleaseService(consent.unlock(client), projectId);
          const release = await releaseService.revoke(args.releaseId).catch((error: unknown) => {
            if (!(error instanceof ReleaseInUseError)) {
              throw error;
            }
            const previews = error.origins.filter((origin) => {
              return origin.kind === "preview";
            });
            const primaries = error.origins.filter((origin) => {
              return origin.kind === "primary";
            });
            const steps = [
              ...(primaries.length > 0 ? ["put another release live on each primary origin"] : []),
              ...(previews.length > 0 ? ["remove each preview"] : []),
            ];
            const next: Suggestion[] = [
              ...(primaries.length > 0
                ? [
                    { id: "deploy", flags: { message: WHAT_CHANGED } } satisfies Suggestion,
                    { id: "deployment:rollback" } satisfies Suggestion,
                  ]
                : []),
              ...previews.map((preview) => {
                return { id: "preview:rm", args: { url: preview.origin } } satisfies Suggestion;
              }),
            ];

            throw refusalError(
              RELEASE_IN_USE_REFUSAL,
              {
                served: new Intl.ListFormat("en", { type: "conjunction" }).format(
                  error.origins.map((origin) => {
                    return `${origin.origin} (${origin.kind}, ${origin.deployment_id})`;
                  }),
                ),
                steps: steps.join(" and "),
                details: { status: error.status, url: error.url, body: error.body },
              },
              { next },
            );
          });
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
      }),
    );
  }
}
