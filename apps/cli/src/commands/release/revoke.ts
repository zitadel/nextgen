import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { mutatedData } from "../../lib/oclif/envelope";
import { revokeRelease } from "../../lib/release";
import { Destructive } from "../../lib/oclif/destructive";

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

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(ReleaseRevoke);
    await this.toMeta(flags);
    const releaseId = args.release_id;

    return this.emit(
      await this.confirmed({
        verb: "revoke",
        name: `revoke ${releaseId}`,
        message: `Revoke ${releaseId}? Its content can never be served again.`,
        preview: () => ({
          status: "ok",
          data: { dry_run: true, release_id: releaseId },
          pretty: `Would revoke ${releaseId}. Nothing was revoked (dry run).`,
        }),
        prepare: () => this.connect(),
        apply: async (consent, { client, projectId }) => {
          const release = await revokeRelease(consent, client, projectId, releaseId);
          return {
            status: "ok",
            // The lifecycle-mutation shape every revoke answers with, plus when.
            data: {
              ...mutatedData({ release_id: release.id }, "revoked"),
              revoked_at: release.revoked_at,
            },
            pretty: `Revoked ${release.id}`,
          };
        },
      }),
    );
  }
}
