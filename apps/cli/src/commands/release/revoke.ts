import { Flags } from "@oclif/core";

import {
  type Admitted,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankArg,
} from "@/lib/oclif";
import { mutatedData } from "@/lib/oclif/envelope";
import { ReleaseService } from "@/lib/backend";
import { Destructive } from "@/lib/oclif/destructive";
import { prose } from "@/lib/oclif/rendering";

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
    release_id: nonBlankArg({ required: true, description: "The release to revoke." }),
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
          const release = await releaseService.revoke(args.releaseId);
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
