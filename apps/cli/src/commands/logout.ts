import { revokeLogin } from "../lib/login/flow";
import { removeLogin } from "../lib/login/store";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import { ignoredCredentialFlag } from "../lib/oclif/environment-flags";
import { DEFAULT_SERVER } from "../lib/server";

/**
 * `zitadel logout` — forget the sign-in `zitadel login` stored for a server,
 * and revoke its refresh token there. An access token already issued lives
 * out its few minutes: the server stores none to revoke (ADR 037).
 */
export default class Logout extends EnvironmentCommand {
  static override description =
    "Sign out of a server. It revokes the `zitadel login` refresh token there and forgets the sign-in.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 8;

  static override examples = ["<%= config.bin %> <%= command.id %> --server local"];

  // It ends the sign-in itself, never with a secret.
  static override baseFlags = {
    ...EnvironmentCommand.baseFlags,
    credential: ignoredCredentialFlag,
  };

  protected async execute(): Promise<JsonEnvelope> {
    const server = this.environment.values.ZITADEL_URL?.value ?? DEFAULT_SERVER;

    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: { title: `Would sign out of ${server}.`, server, dry_run: true },
      });
    }
    const removed = await removeLogin(server, process.env);
    if (removed === undefined) {
      return this.emit({
        status: "skipped",
        reason: "not-signed-in",
        data: { server, signed_out: false, revoked: false },
      });
    }
    const revoked = await revokeLogin(removed);
    return this.emit({
      status: "ok",
      data: {
        title: `Signed out of ${server}.`,
        server,
        signed_out: true,
        revoked,
      },
      next: { commands: [this.suggest("login")] },
    });
  }
}
