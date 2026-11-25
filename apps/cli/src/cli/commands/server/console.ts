import { Flags } from "@oclif/core";

import { openInBrowser } from "@/lib/browser";
import { Environment } from "@/lib/environment";
import {
  AdminSession,
  LocalRuntime,
  LocalServerAdminFileMalformedError,
  LocalServerFileBlockedError,
  LocalServerFileUnreadableError,
  ZitadelRuntime,
} from "@/lib/server";
import { section } from "@/lib/ui";
import type { Admitted, CommandResult } from "@/cli/core";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { CommandGroups } from "@/cli/commands/groups";
import { ServerCommand } from "@/cli/commands/server-command";
import { Previewable } from "@/cli/core/previewable";
import { LocalServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { Telemetered } from "@/cli/telemetry/telemetered";

/** How a directory with no local admin, and no parent holding one, is refused. */
const NO_LOCAL_ADMIN_REFUSAL = {
  message: "No local admin in this directory or its parents",
  hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
  next: [{ id: "start" }],
} as const satisfies Refusal;

/** How a start of the local server is refused: LocalServerAdminFileMalformedError. */
const ADMIN_FILE_MALFORMED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Delete {path} and run `zitadel reset --force`, then `zitadel start`. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.",
  details: "{details}",
  next: [
    {
      id: "reset",
      flags: {
        force: true,
      },
    },
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a start of the local server is refused: LocalServerFileUnreadableError. */
const FILE_UNREADABLE_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Check that {path} and its directory are readable by you.",
  details: "{details}",
} as const satisfies Refusal;

/** How a start of the local server is refused: LocalServerFileBlockedError. */
const FILE_BLOCKED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "The file {path} exists but could not be read; fix its permissions or remove it.",
  details: "{details}",
} as const satisfies Refusal;

/**
 * `zitadel console` — open the console of the server the project uses. Where a
 * local server was started that is the local console, signed in as the local
 * admin `zitadel start` created; every run mints a fresh one-time link, so the
 * command is also how you get back in after the session ends. Otherwise, for a
 * project on a cloud or self-hosted server, it is that server's console, where
 * you sign in yourself.
 */
export default class Console extends Telemetered(
  LocalServerCommand(Previewable(ServerCommand(BaseCommand))),
) {
  static override description =
    "Open the console of the server the project uses.\n\nWhere a local server was started, the console opens signed in as the local admin the start command created: run this in the directory it ran in, or one inside it, since the local admin is read from the nearest .zitadel/local/ on the way up. Otherwise a project on a cloud or self-hosted server opens that server's console, where you sign in yourself.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 5;

  static override examples = ["<%= config.bin %> console", "<%= config.bin %> console --no-open"];
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
   * the run has no context of its own yet. A server that cannot be resolved is
   * the run's error, not a missing local setup.
   */
  protected override async sourceOf(flags: Record<string, unknown>, cwd: string): Promise<string> {
    const found = await LocalRuntime.findAdminDir(cwd);
    if (found === undefined) {
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

  /**
   * Says what the command would open, without opening it. A link is minted by
   * running the real login flow, which burns a one-time handoff token on the
   * server, a mutation, so a dry run only reports who it would sign in as.
   *
   * @returns The result of the dry run.
   */
  protected async preview(): Promise<CommandResult> {
    const target = await this.targeted();

    if (target.kind === "remote") {
      const dryRun = dryRunResult({
        verb: "open",
        topic: "console",
        noun: "the console",
        next: await this.realRun(),
      });

      return {
        ...dryRun,
        pretty: undefined,
        data: { ...(dryRun.data as object), console_url: target.consoleUrl },
        summary: {
          ...dryRun.summary,
          sections: [section(undefined, ["Console", escapeControlCharacters(target.consoleUrl)])],
        },
      };
    }

    const dryRun = dryRunResult({
      verb: "mint",
      topic: "console",
      noun: "a console sign-in link",
      next: await this.realRun(),
    });

    return {
      ...dryRun,
      pretty: undefined,
      data: { ...(dryRun.data as object), signed_in_as: target.admin.email },
      summary: {
        ...dryRun.summary,
        sections: [
          section(undefined, ["Signed in as", escapeControlCharacters(target.admin.email)]),
        ],
      },
    };
  }

  /**
   * Opens the console. With no local server started here, the server
   * `--server` or the project names, when it is not on this machine, has only
   * its own console to open.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The result of the run.
   */
  protected async apply({ flags }: Admitted<typeof Console>): Promise<CommandResult> {
    const target = await this.targeted();

    if (target.kind === "remote") {
      this.debug("The console of this project's server:");
      this.debug(escapeControlCharacters(target.consoleUrl));
      const skipLaunch = flags.noOpen || this.nonInteractive;
      const opened = skipLaunch ? false : (await openInBrowser(target.consoleUrl)).opened;

      const title = "Console";

      return {
        status: "ok",
        data: {
          title,
          console_url: target.consoleUrl,
          browser_opened: opened,
        },
        summary: {
          title,
          sections: [section(undefined, ["Console", escapeControlCharacters(target.consoleUrl)])],
        },
      };
    }

    const { localDir, admin } = target;
    const serverUrl = await this.serverInThisFolder(localDir).runningUrl();
    const signInUrl = await new AdminSession(serverUrl, admin, this.signal).consoleUrl();

    this.debug(`Signed in to the local console as ${escapeControlCharacters(admin.email)}:`);
    this.debug(escapeControlCharacters(signInUrl));
    const skipLaunch = flags.noOpen || this.nonInteractive;
    const opened = skipLaunch ? false : (await openInBrowser(signInUrl)).opened;

    const title = "Local console sign-in link";

    return {
      status: "ok",
      data: {
        title,
        signed_in_as: admin.email,
        sign_in_url: signInUrl,
        browser_opened: opened,
      },
      summary: {
        title,
        sections: [
          section(undefined, ["Signed in as", escapeControlCharacters(admin.email)]),
          section(undefined, ["Link", escapeControlCharacters(signInUrl)]),
        ],
      },
      next: {
        actions: [
          `The link signs you in once. Run ${await this.again("console", {})} again for a fresh one.`,
        ],
      },
    };
  }

  /**
   * What the console this run opens is: the one of a server that is not on
   * this machine, when `--server` or the project names one, or the local
   * server's, signed in as the admin this folder holds.
   *
   * @returns The console's URL, or the local folder and its admin.
   * @throws {Error} When there is no local admin to sign in as.
   */
  private async targeted() {
    if (this.named !== undefined && !ZitadelRuntime.fromUrl(this.named).isLoopback()) {
      return {
        kind: "remote" as const,
        consoleUrl: ZitadelRuntime.fromUrl(this.named).consoleUrl(),
      };
    }

    const found = await LocalRuntime.findAdminDir(this.cwd);
    const localDir = found ?? this.cwd;
    const admin = await this.serverInThisFolder(localDir)
      .admin()
      .catch((error: unknown) => {
        if (error instanceof LocalServerAdminFileMalformedError) {
          throw refusalError(ADMIN_FILE_MALFORMED_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
            path: String(error.details?.path ?? ""),
          });
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerFileUnreadableError) {
          throw refusalError(FILE_UNREADABLE_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
            path: String(error.details?.path ?? ""),
          });
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerFileBlockedError) {
          throw refusalError(FILE_BLOCKED_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
            path: String(error.details?.path ?? ""),
          });
        }
        throw error;
      });
    if (admin === undefined) {
      throw refusalError(NO_LOCAL_ADMIN_REFUSAL, {});
    }

    return {
      kind: "local" as const,
      localDir,
      admin,
    };
  }
}
