import { Flags } from "@oclif/core";
import consola from "consola";

import { createZitadelClient } from "../lib/api-client";
import { openInBrowser } from "../lib/browser";
import { discoverAuthorization } from "../lib/login/discovery";
import { signIn, toStoredLogin } from "../lib/login/flow";
import { credentialsPath, writeLogin } from "../lib/login/store";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../lib/oclif";
import { nextCommandsData } from "../lib/oclif/envelope";
import { DEFAULT_SERVER } from "../lib/server";

/** How long `login` waits for the browser by default. */
const DEFAULT_TIMEOUT_SECONDS = 300;

/**
 * `zitadel login` — sign in to a server as yourself.
 *
 * The CLI is a public client of the platform project's built-in `zitadel`
 * app: the authorization code flow with PKCE and a loopback redirect, the
 * way `gh auth login` signs in. The browser signs in through the server's own
 * login, so the CLI never sees a password, and the token it gets is a user
 * bearer for the platform API (ADR 053 §5): commands that accept it act as
 * you, with your grants, instead of with a project secret.
 */
export default class Login extends EnvironmentCommand {
  static override description =
    "Sign in to a Zitadel server as yourself, in the browser. Commands that accept it then act as you instead of with a project secret.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 5;

  static override examples = [
    "<%= config.bin %> <%= command.id %> --server local",
    "<%= config.bin %> <%= command.id %> --server https://api.zitadel.cloud",
    "<%= config.bin %> <%= command.id %> --no-open",
  ];

  static override flags = {
    "no-open": Flags.boolean({
      description: "Print the sign-in link instead of opening a browser.",
    }),
    timeout: Flags.integer({
      min: 1,
      description: `Seconds to wait for the browser step. Defaults to ${DEFAULT_TIMEOUT_SECONDS}.`,
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Login);
    await this.toMeta(flags);
    const server = this.environment.values.ZITADEL_URL?.value ?? DEFAULT_SERVER;

    if (this.meta.dryRun) {
      const authorization = await discoverAuthorization(server);
      return this.emit({
        status: "ok",
        data: {
          title: "Would sign in.",
          server,
          issuer: authorization.issuer,
          dry_run: true,
        },
      });
    }

    const tokens = await signIn({
      server,
      timeoutMs: (flags.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
      present: async (url) => {
        // An agent reading --json still has to hand the link to a person,
        // so it goes to stderr, which the envelope does not share.
        if (this.jsonEnabled()) {
          process.stderr.write(`Sign in at: ${url}\n`);
        } else {
          consola.info(`Sign in to ${server} in your browser:`);
          consola.log(url);
        }
        if (!flags["no-open"]) {
          await openInBrowser(url);
        }
      },
    });

    // Who signed in is the API's answer, not the token's claims: the same
    // call `whoami` makes proves the token works.
    const user = await createZitadelClient({
      baseUrl: server,
      token: tokens.accessToken,
    }).getMyUser();
    const login = toStoredLogin(
      tokens,
      { id: user.id, ...(user.identifier === undefined ? {} : { identifier: user.identifier }) },
      new Date(),
    );
    await writeLogin(server, login, process.env);

    const who = login.user.identifier ?? login.user.id;
    return this.emit({
      status: "ok",
      data: {
        title: `Signed in to ${server} as ${who}.`,
        server,
        user_id: login.user.id,
        ...(login.user.identifier === undefined ? {} : { identifier: login.user.identifier }),
        issuer: login.issuer,
        client_id: login.client_id,
        access_token_expires_at: login.access_token_expires_at,
        has_refresh_token: login.refresh_token !== undefined,
        stored_at: credentialsPath(process.env),
        ...nextCommandsData([this.suggest("whoami")]),
      },
    });
  }
}
