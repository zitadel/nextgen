import { createZitadelClient } from "../lib/api-client";
import { ZitadelError } from "../lib/errors";
import { developerAccessToken } from "../lib/login/flow";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import { nextCommandsData } from "../lib/oclif/envelope";
import { DEFAULT_SERVER } from "../lib/server";

/**
 * `zitadel whoami` — who `zitadel login` signed you in as at a server.
 *
 * It asks the server, with the stored token (refreshed when it expired), so
 * it also proves the sign-in still works.
 */
export default class Whoami extends EnvironmentCommand {
  static override description =
    "Show who you are signed in as at a server. It asks the server with your `zitadel login` token.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 6;

  static override examples = [
    "<%= config.bin %> <%= command.id %> --server local",
    "<%= config.bin %> <%= command.id %> --json",
  ];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Whoami);
    await this.toMeta(flags);
    const server = this.environment.values.ZITADEL_URL?.value ?? DEFAULT_SERVER;

    const signedIn = await developerAccessToken(server, process.env);
    if (signedIn === undefined) {
      throw new ZitadelError("E_CREDENTIAL_MISSING", `You are not signed in to ${server}.`, {
        hint: "Sign in with `zitadel login`; it opens a browser.",
        nextCommands: [this.suggest("login")],
      });
    }
    const user = await createZitadelClient({ baseUrl: server, token: signedIn.token }).getMyUser();
    const who = user.identifier ?? user.id;
    return this.emit({
      status: "ok",
      data: {
        title: `Signed in to ${server} as ${who}.`,
        server,
        user_id: user.id,
        ...(user.identifier === undefined ? {} : { identifier: user.identifier }),
        ...(user.display === undefined ? {} : { display: user.display }),
        client_id: signedIn.login.client_id,
        access_token_expires_at: signedIn.login.access_token_expires_at,
        ...nextCommandsData([this.suggest("logout")]),
      },
    });
  }
}
