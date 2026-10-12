import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { revokeRelease } from "../../lib/release";
import { ZitadelError } from "../../lib/errors";
import { publicCliCommand } from "../../lib/public-cli";

/**
 * `zitadel release revoke <release_id>` — mark a release so its content is
 * never served again.
 *
 * A release an origin still serves cannot be revoked; deploy another release
 * there or roll it back first. Revoking is idempotent and cannot be undone, so
 * it takes the same `--force`-or-confirm gate the destructive commands use.
 */
export default class ReleaseRevoke extends EnvironmentCommand {
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
      description: "Revoke without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(ReleaseRevoke);
    await this.toMeta(flags);
    const { nonInteractive, force, cliVersion } = this.meta;
    const releaseId = args.release_id;

    if (!force) {
      if (nonInteractive) {
        throw new ZitadelError(
          "E_VALIDATION",
          "Revoking a release requires --force in non-interactive mode",
          {
            hint: `Pass --force to revoke ${releaseId}.`,
            nextCommands: [publicCliCommand(`release revoke ${releaseId} --force`, cliVersion)],
          },
        );
      }
      const answer = await confirm({
        message: `Revoke ${releaseId}? Its content can never be served again.`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel("Revoke cancelled.");
        return this.emit({ status: "skipped", reason: "revoke-cancelled" });
      }
    }

    const { client, projectId } = await this.connect();

    const release = await revokeRelease(client, projectId, releaseId);

    return this.emit({
      status: "ok",
      data: { release_id: release.id, revoked_at: release.revoked_at },
      pretty: `Revoked ${release.id}`,
    });
  }
}
