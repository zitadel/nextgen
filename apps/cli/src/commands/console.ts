import { Flags } from "@oclif/core";
import consola from "consola";

import { openInBrowser } from "../lib/browser";
import { consoleSignInUrl } from "../lib/local-server/sign-in";
import { DEFAULT_LOCAL_SERVER_URL } from "../lib/local-server/runtime";
import { LocalServer } from "../lib/local-server/server";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { localAdmin } from "./local-server/requirements/local-admin";

/**
 * `zitadel console` — open the local console signed in as the local
 * admin `zitadel start` created. Every run mints a fresh one-time link, so the
 * command is also how you get back in after the session ends.
 */
export default class Console extends BaseCommand {
  static override description =
    "Open the local console, signed in as the local admin.\n\nThe local admin is the one `zitadel start` created. Run this in the directory `zitadel start` ran in, or one inside it: the local admin is read from the nearest `.zitadel/local/` on the way up.";
  static override group = CommandGroups.localDevelopment;
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --no-open",
  ];

  static override flags = {
    "no-open": Flags.boolean({
      description: "Print the sign-in link instead of opening a browser.",
    }),
  };

  static override meta = {
    resolveServer: false,
    source: DEFAULT_LOCAL_SERVER_URL,
  };

  static override requires = {
    local: localAdmin,
  };

  protected async execute({ flags, local }: Admitted<typeof Console>): Promise<JsonEnvelope> {
    const { admin, dir: localDir } = local;

    // A link is minted by running the real login flow, which burns a one-time
    // handoff token on the server — a mutation, so a dry run only reports who
    // it would sign in as.
    if (this.dryRun) {
      consola.info(`Would mint a console sign-in link for ${admin.email}.`);
      return this.emit({
        status: "ok",
        data: {
          title: "Local console sign-in link.",
          signed_in_as: admin.email,
          dry_run: true,
        },
      });
    }

    const serverUrl = await LocalServer.resolveUrl(localDir);
    const signInUrl = await consoleSignInUrl(serverUrl, admin, this.signal);

    consola.log(`Signed in to the local console as ${admin.email}:`);
    consola.log(signInUrl);
    const skipLaunch = flags.noOpen || this.nonInteractive;
    const opened = skipLaunch ? false : (await openInBrowser(signInUrl)).opened;
    if (!opened) {
      consola.info("Open the link above. It works once; run this command again for a new one.");
    }

    return this.emit({
      status: "ok",
      data: {
        title: "Local console sign-in link.",
        signed_in_as: admin.email,
        sign_in_url: signInUrl,
        browser_opened: opened,
      },
      next: {
        actions: ["The link signs you in once. Run `zitadel console` again for a fresh one."],
      },
    });
  }
}
