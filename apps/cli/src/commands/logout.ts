import { revokeLogin } from "../lib/login/flow";
import { removeLogin } from "../lib/login/store";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import { nextCommandsData } from "../lib/oclif/envelope";
import { DEFAULT_SERVER } from "../lib/server";

/**
 * `zitadel logout` — forget the sign-in `zitadel login` stored for a server,
 * and revoke its refresh token there. An access token already issued lives
 * out its few minutes: the server stores none to revoke (ADR 037).
 */
export default class Logout extends EnvironmentCommand {
  static override description =
    "Sign out of a server: revoke the `zitadel login` refresh token there and forget the sign-in.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 7;

  static override examples = ["<%= config.bin %> <%= command.id %> --server local"];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Logout);
    await this.toMeta(flags);
    const server = this.environment.values.ZITADEL_URL?.value ?? DEFAULT_SERVER;

    if (this.meta.dryRun) {
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
        ...nextCommandsData([this.suggest("login")]),
      },
    });
  }
}
