import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { mutatedData } from "../../lib/oclif/envelope";
import { revokeRelease } from "../../lib/release";
import { Promptable } from "../../lib/oclif/promptable";

/**
 * `zitadel release revoke <release_id>` — mark a release so its content is
 * never served again.
 *
 * A release an origin still serves cannot be revoked; deploy another release
 * there or roll it back first. Revoking is idempotent and cannot be undone, so
 * it takes the same `--force`-or-confirm gate the destructive commands use.
 */
export default class ReleaseRevoke extends Promptable(EnvironmentCommand) {
  static override description = "Revoke a release so its content is never served again.";
  static override group = CommandGroups.configuration;

  static override heading = "Revoking a release";

  static override summarises = true;
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
      description: "Revoke without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(ReleaseRevoke);
    await this.toMeta(flags);
    const { dryRun } = this.meta;
    const releaseId = args.release_id;

    // A dry run makes no request, so it answers before the connection and
    // before the destructive-confirm gate: revoking cannot be undone, and a
    // dry run must revoke nothing and so needs no confirmation.
    if (dryRun) {
      return this.emit({
        status: "ok",
        data: { dry_run: true, release_id: releaseId },
        pretty: `Would revoke ${releaseId} (dry run)`,
      });
    }

    const confirmed = await this.ask.confirm({
      name: `revoke ${releaseId}`,
      message: `Revoke ${releaseId}? Its content can never be served again.`,
      retry: this.suggest(`release revoke ${releaseId} --force`),
    });
    if (!confirmed) {
      return this.emit({ status: "skipped", reason: "revoke-cancelled" });
    }

    const { client, projectId } = await this.connect();

    const release = await revokeRelease(client, projectId, releaseId);

    return this.emit({
      status: "ok",
      // The lifecycle-mutation shape every revoke answers with, plus when.
      data: {
        ...mutatedData({ release_id: release.id }, "revoked"),
        revoked_at: release.revoked_at,
      },
      pretty: `Revoked ${release.id}`,
    });
  }
}
