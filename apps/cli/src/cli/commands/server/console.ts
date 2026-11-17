import { Flags } from "@oclif/core";

import { openInBrowser } from "@/lib/browser";
import { Environment } from "@/lib/environment";
import { AdminSession, LocalRuntime, ZitadelRuntime } from "@/lib/server";
import { section, log } from "@/lib/ui";
import { LocalServerCommand, ServerCommand } from "@/cli/commands/server-command";
import type { Admitted, JsonEnvelope } from "@/lib/oclif";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";

import { escapeControlCharacters } from "@/lib/terminal-text";
import { BaseCommand } from "@/lib/oclif";
import { CommandGroups } from "@/cli/commands/groups";

/** How a directory with no local admin, and no parent holding one, is refused. */
const NO_LOCAL_ADMIN_REFUSAL = {
  message: "No local admin in this directory or its parents",
  hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
  next: [{ id: "start" }],
} as const satisfies Refusal;

/**
 * `zitadel console` — open the console of the server the project uses. Where a
 * local server was started that is the local console, signed in as the local
 * admin `zitadel start` created; every run mints a fresh one-time link, so the
 * command is also how you get back in after the session ends. Otherwise, for a
 * project on a cloud or self-hosted server, it is that server's console, where
 * you sign in yourself.
 */
export default class Console extends LocalServerCommand(ServerCommand(BaseCommand)) {
  static override group = CommandGroups.localServer;
  static override description =
    "Open the console of the server the project uses.\n\nWhere a local server was started, the console opens signed in as the local admin the start command created: run this in the directory it ran in, or one inside it, since the local admin is read from the nearest .zitadel/local/ on the way up. Otherwise a project on a cloud or self-hosted server opens that server's console, where you sign in yourself.";
  static override groupOrder = 5;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --no-open",
  ];
  static override flags = {
    "no-open": Flags.boolean({
      description: "Print the link instead of opening a browser.",
    }),
  };

  /** The server a remote console is opened for, read once by {@link sourceOf}. */
  private named: string | undefined;

  /**
   * The server the console is about, read before the run has a context so that
   * every event and any refusal names it. The local server a `start` left in this
   * directory or a parent (its runtime metadata sits beside the admin it
   * created) is the one; only without it does `--server`, or else the project's
   * own server, decide. The environment is read once, here, from the process:
   * the run has no context of its own yet.
   */
  protected override async sourceOf(flags: Record<string, unknown>, cwd: string): Promise<string> {
    const found = await LocalRuntime.findAdminDir(cwd);
    if (found === undefined) {
      // A server that cannot be resolved is the run's error, not a missing local setup.
      const environment = await Environment.resolve({
        servers: ZitadelRuntime,
        cwd,
        env: process.env,
        serverFlag: typeof flags.server === "string" ? flags.server : undefined,
      });
      this.named = environment.values.ZITADEL_URL?.value;
    }

    return (
      this.named ??
      (await this.serverInThisFolder(found ?? cwd).record())?.server_url ??
      LocalRuntime.DEFAULT_URL
    );
  }

  protected async execute({ flags }: Admitted<typeof Console>): Promise<JsonEnvelope> {
    // With no local server started here, the server `--server` or the project
    // names, when it is not on this machine, has only its own console to open.
    if (this.named !== undefined && !ZitadelRuntime.fromUrl(this.named).isLoopback()) {
      const consoleUrl = ZitadelRuntime.fromUrl(this.named).consoleUrl();

      if (this.dryRun) {
        const title = "Would open the console (dry run)";

        return this.emit({
          status: "ok",
          data: {
            title,
            dry_run: true,
            console_url: consoleUrl,
          },
          summary: {
            title,
            sections: [section(undefined, ["Console", escapeControlCharacters(consoleUrl)])],
          },
          next: { commands: [await this.realRun()] },
        });
      }

      log.plain("The console of this project's server:");
      log.plain(escapeControlCharacters(consoleUrl));
      const skipLaunch = flags.noOpen || this.nonInteractive;
      const opened = skipLaunch ? false : (await openInBrowser(consoleUrl)).opened;

      const title = "Console";

      return this.emit({
        status: "ok",
        data: {
          title,
          console_url: consoleUrl,
          browser_opened: opened,
        },
        summary: {
          title,
          sections: [],
        },
      });
    }

    const found = await LocalRuntime.findAdminDir(this.cwd);
    const localDir = found ?? this.cwd;
    const admin = await this.serverInThisFolder(localDir).admin();
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
        next: { commands: [await this.realRun()] },
      });
    }

    const serverUrl = await this.serverInThisFolder(localDir).runningUrl();
    const signInUrl = await new AdminSession(serverUrl, admin, this.signal).consoleUrl();

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
          `The link signs you in once. Run ${await this.again("console", {})} again for a fresh one.`,
        ],
      },
    });
  }
}
