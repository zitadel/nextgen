import { Args, Flags } from "@oclif/core";
import { z } from "zod";

import { ReleaseService } from "@/lib/backend";
import { RevokeReleaseParams } from "@/lib/backend/schemas";
import { type Admitted, CommandGroups, EnvironmentCommand, type JsonEnvelope } from "@/lib/oclif";
import { Cmd } from "@/lib/cmd";
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
    next: ["release list"],
    details: {
      argument: "{input}",
    },
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
              commands: [this.suggest(`release revoke ${Cmd.quote(args.releaseId)} --force`)],
            },
          };
        },
        prepare: () => {
          return this.connect();
        },
        apply: async (consent, { client, projectId }) => {
          const releaseService = new ReleaseService(consent.unlock(client), projectId);
          const release = await releaseService.revoke(args.releaseId);
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
