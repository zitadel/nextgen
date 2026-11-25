import { Flags } from "@oclif/core";

import { openInBrowser } from "@/lib/browser";
import { Cmd } from "@/lib/cmd";
import {
  Environment,
  EnvironmentNameInvalidError,
  EnvironmentServerInvalidError,
} from "@/lib/environment";
import {
  AdminSession,
  LocalRuntime,
  LocalServerAdminFileMalformedError,
  LocalServerAdminPlatformMissingError,
  LocalServerAdminRejectedError,
  LocalServerAdminSessionError,
  LocalServerAdminUnreadableError,
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRespondingError,
  LocalServerNotRunningError,
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

/** How an environment name that cannot be used in a path is refused. */
const NAME_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Pass a safe --env or set ZITADEL_ENV.",
} as const satisfies Refusal;

/** How a server address that is not a URL is refused. */
const SERVER_INVALID_REFUSAL = {
  message: "{message}",
} as const satisfies Refusal;

/** How a run is refused when no local server was started in the folder or a parent. */
const LOCAL_SERVER_NOT_RUNNING_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when the local server this folder started does not answer. */
const LOCAL_SERVER_NOT_RESPONDING_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "No healthy local server responded at {server_url}. Run `zitadel start` to bring it back.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when the local server a parent folder started does not answer. */
const LOCAL_SERVER_NOT_RESPONDING_ELSEWHERE_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "No healthy local server responded at {server_url}. It was started in {directory}, so run `zitadel start --cwd {directory}` to bring it back.",
  details: {
    server_url: "{server_url}",
    suggested_args: [["start", "--cwd", "{path}"]],
  },
  next: ["{start}"],
} as const satisfies Refusal;

/** How a run is refused when the local admin file is not in the shape it is written in. */
const ADMIN_FILE_MALFORMED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Delete the local admin file and run `zitadel reset --force`, then `zitadel start`. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.",
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

/** How a run is refused when the local admin file cannot be read. */
const ADMIN_UNREADABLE_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Check that the local admin file is readable by you; `zitadel start` writes it owner-only.",
} as const satisfies Refusal;

/** How a run is refused when the server does not know the local admin. */
const ADMIN_REJECTED_REFUSAL = {
  code: "E_AUTH",
  message: "{message}",
  hint: "Check `zitadel logs` first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — `zitadel reset --force` deletes the local data so `zitadel start` can import it again.",
  next: [
    {
      id: "logs",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when the server refuses the local admin's session. */
const ADMIN_SESSION_REFUSAL = {
  code: "E_AUTH",
  message: "{message}",
  hint: "Check `zitadel logs` for why the local server refused the admin's session.",
} as const satisfies Refusal;

/** How a run is refused when the server does not host the platform project. */
const PLATFORM_MISSING_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
  next: [
    {
      id: "stop",
    },
    {
      id: "start",
    },
  ],
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
      try {
        const environment = await Environment.resolve({
          servers: ZitadelRuntime,
          cwd,
          env: process.env,
          serverFlag: typeof flags.server === "string" ? flags.server : undefined,
        });
        this.named = environment.values.ZITADEL_URL?.value;
      } catch (error) {
        if (error instanceof EnvironmentNameInvalidError) {
          throw refusalError(NAME_INVALID_REFUSAL, {
            message: error.message,
          });
        }
        if (error instanceof EnvironmentServerInvalidError) {
          throw refusalError(SERVER_INVALID_REFUSAL, {
            message: error.message,
          });
        }
        if (error instanceof LocalServerNotRunningError) {
          throw refusalError(LOCAL_SERVER_NOT_RUNNING_REFUSAL, {
            message: error.message,
          });
        }
        if (error instanceof LocalServerNotRespondingError) {
          throw refusalError(LOCAL_SERVER_NOT_RESPONDING_REFUSAL, {
            message: error.message,
            server_url: error.serverUrl,
          });
        }
        if (error instanceof LocalServerNotRespondingElsewhereError) {
          throw refusalError(
            LOCAL_SERVER_NOT_RESPONDING_ELSEWHERE_REFUSAL,
            {
              message: error.message,
              server_url: error.serverUrl,
              directory: Cmd.quote(error.directory),
              path: error.directory,
            },
            {
              start: {
                id: "start",
                flags: {
                  cwd: error.directory,
                },
              },
            },
          );
        }
        throw error;
      }
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
    // biome-ignore lint/plugin: assigned inside the try that guards the call, read after it
    let signInUrl: string;
    try {
      const serverUrl = await this.serverInThisFolder(localDir).runningUrl();
      signInUrl = await new AdminSession(serverUrl, admin, this.signal).consoleUrl();
    } catch (error) {
      if (error instanceof LocalServerNotRunningError) {
        throw refusalError(LOCAL_SERVER_NOT_RUNNING_REFUSAL, {
          message: error.message,
        });
      }
      if (error instanceof LocalServerNotRespondingError) {
        throw refusalError(LOCAL_SERVER_NOT_RESPONDING_REFUSAL, {
          message: error.message,
          server_url: error.serverUrl,
        });
      }
      if (error instanceof LocalServerNotRespondingElsewhereError) {
        throw refusalError(
          LOCAL_SERVER_NOT_RESPONDING_ELSEWHERE_REFUSAL,
          {
            message: error.message,
            server_url: error.serverUrl,
            directory: Cmd.quote(error.directory),
            path: error.directory,
          },
          {
            start: {
              id: "start",
              flags: {
                cwd: error.directory,
              },
            },
          },
        );
      }
      if (error instanceof LocalServerAdminRejectedError) {
        throw refusalError(ADMIN_REJECTED_REFUSAL, {
          message: error.message,
        });
      }
      if (error instanceof LocalServerAdminSessionError) {
        throw refusalError(ADMIN_SESSION_REFUSAL, {
          message: error.message,
        });
      }
      if (error instanceof LocalServerAdminPlatformMissingError) {
        throw refusalError(PLATFORM_MISSING_REFUSAL, {
          message: error.message,
        });
      }
      throw error;
    }

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
    try {
      const admin = await this.serverInThisFolder(localDir).admin();
      if (admin === undefined) {
        throw refusalError(NO_LOCAL_ADMIN_REFUSAL, {});
      }

      return {
        kind: "local" as const,
        localDir,
        admin,
      };
    } catch (error) {
      if (error instanceof LocalServerAdminFileMalformedError) {
        throw refusalError(ADMIN_FILE_MALFORMED_REFUSAL, {
          message: error.message,
        });
      }
      if (error instanceof LocalServerAdminUnreadableError) {
        throw refusalError(ADMIN_UNREADABLE_REFUSAL, {
          message: error.message,
        });
      }
      throw error;
    }
  }
}
