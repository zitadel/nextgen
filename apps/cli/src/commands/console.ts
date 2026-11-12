import { Flags } from "@oclif/core";

import { openInBrowser } from "@/lib/browser";
import { findLocalAdminDir, readLocalAdmin } from "@/lib/local-server/admin-credential";
import { DEFAULT_LOCAL_SERVER_URL, readRuntimeMetadata } from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { consoleSignInUrl } from "@/lib/local-server/sign-in";
import { log } from "@/lib/log";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { suggestion } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { section } from "@/lib/ui";

/** How a directory with no local admin, and no parent holding one, is refused. */
const NO_LOCAL_ADMIN_REFUSAL: Refusal = {
  message: "No local admin in this directory or its parents",
  hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
  next: [suggestion("start")],
};

/**
 * `zitadel console` — open the local console signed in as the local
 * admin `zitadel start` created. Every run mints a fresh one-time link, so the
 * command is also how you get back in after the session ends.
 */
export default class Console extends BaseCommand {
  static override description =
    "Open the local console, signed in as the local admin.\n\nThe local admin is the one the start command created. Run this in the directory it ran in, or one inside it: the local admin is read from the nearest .zitadel/local/ on the way up.";
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
  };

  /**
   * The server the console signs into, read before the run has a context so
   * that every event and any refusal names it: `start` may have run in a
   * parent of the app directory, and its runtime metadata sits beside the
   * admin it created, so both are read from there.
   */
  protected override async sourceOf(_flags: unknown, cwd: string): Promise<string> {
    const localDir = (await findLocalAdminDir(cwd)) ?? cwd;
    return (await readRuntimeMetadata(localDir))?.server_url ?? DEFAULT_LOCAL_SERVER_URL;
  }

  protected async execute({ flags }: Admitted<typeof Console>): Promise<JsonEnvelope> {
    const localDir = (await findLocalAdminDir(this.cwd)) ?? this.cwd;
    const admin = await readLocalAdmin(localDir);
    if (admin === undefined) {
      throw refusalError(NO_LOCAL_ADMIN_REFUSAL, {});
    }

    // A link is minted by running the real login flow, which burns a one-time
    // handoff token on the server — a mutation, so a dry run only reports who
    // it would sign in as.
    if (this.dryRun) {
      const title = "Would mint a console sign-in link (dry run)";

      return this.emit({
        status: "ok",
        data: {
          title,
          dry_run: true,
          signed_in_as: admin.email,
        },
        summary: {
          title,
          sections: [section(undefined, ["Signed in as", escapeControlCharacters(admin.email)])],
        },
        next: { commands: [this.suggest("console")] },
      });
    }

    const serverUrl = await LocalServer.resolveUrl(localDir);
    const signInUrl = await consoleSignInUrl(serverUrl, admin, this.signal);

    log.plain(`Signed in to the local console as ${escapeControlCharacters(admin.email)}:`);
    log.plain(escapeControlCharacters(signInUrl));
    const skipLaunch = flags.noOpen || this.nonInteractive;
    const opened = skipLaunch ? false : (await openInBrowser(signInUrl)).opened;

    const title = "Local console sign-in link";

    return this.emit({
      status: "ok",
      data: {
        title,
        signed_in_as: admin.email,
        sign_in_url: signInUrl,
        browser_opened: opened,
      },
      summary: {
        title,
        sections: [],
      },
      next: {
        actions: [
          `The link signs you in once. Run ${this.suggest("console")} again for a fresh one.`,
        ],
      },
    });
  }
}
