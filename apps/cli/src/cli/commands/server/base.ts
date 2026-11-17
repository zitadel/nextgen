import { errorMessage, toZitadelError, ZitadelError } from "@/lib/errors";
import {
  DockerUnavailableError,
  LocalRuntime,
  type LocalServers,
  NoFreePortError,
  PortInUseError,
  PsLocalServers,
  ServerStartError,
  ServerStopError,
} from "@/lib/server";
import { distinct, shellCommand, type SuggestedCommand } from "@/lib/suggestion";
import { CommandGroups } from "@/cli/commands/groups";
import { log } from "@/lib/ui";
import { BaseCommand } from "@/lib/oclif";

/**
 * A command about the Zitadel server that runs on this machine.
 *
 * Every such command acts on one project folder. `folderRule` says which: with
 * `"exact"` it is the folder the command runs in (`start`, `stop`, `reset`), and
 * with `"nearest"` it is the closest folder, that one or a parent, where `start`
 * was run (`logs`, `console`). Acting on the wrong one manages another
 * project's server, so a command states its rule and nothing else decides it.
 *
 * `status` is the one command about this server that does not extend it: it also
 * reads the project's environment, so it extends `EnvironmentCommand`.
 */
export abstract class ServerCommand extends BaseCommand {
  static override group: string = CommandGroups.localServer;
  static override meta = { resolveServer: false };
  static folderRule: "exact" | "nearest" = "exact";

  /**
   * The server of exactly the folder the command runs in. It may not have been
   * started yet.
   *
   * @param cwd - The folder; the command's own unless a caller names another.
   * @returns That folder's server.
   */
  protected serverInThisFolder(cwd = this.cwd): LocalRuntime {
    return LocalRuntime.forFolder(cwd, {
      cliVersion: this.config.version,
      progress: (message) => {
        log.info(message);
      },
    });
  }

  /**
   * The server of the closest folder, this one or a parent, where `start` was
   * run.
   *
   * @param cwd - Where to start looking; the command's own folder unless a caller names another.
   * @returns That folder's server, or `undefined` when no folder above started one.
   */
  protected serverInNearestFolder(cwd = this.cwd): Promise<LocalRuntime | undefined> {
    return LocalRuntime.findStartedFrom(cwd, {
      cliVersion: this.config.version,
      progress: (message) => {
        log.info(message);
      },
    });
  }

  /**
   * Which local servers are running on the machine. Production asks `ps`; a
   * test overrides this to answer for the machine.
   *
   * @returns The machine's processes.
   */
  protected localServers(): LocalServers {
    return new PsLocalServers();
  }

  /**
   * The address every event and refusal of the run names. It is read before the
   * run starts, so the very first event already names the right server.
   *
   * @param _flags - Unused; the folder alone decides.
   * @param cwd - The folder the command runs in.
   * @returns The server's address, or the default one when none was started.
   */
  protected override async sourceOf(_flags: unknown, cwd: string): Promise<string> {
    const { folderRule } = this.constructor as typeof ServerCommand;
    if (folderRule === "nearest") {
      const server = await this.serverInNearestFolder(cwd);
      if (server === undefined) {
        return LocalRuntime.DEFAULT_URL;
      } else {
        return server.url();
      }
    } else {
      return this.serverInThisFolder(cwd).url();
    }
  }

  /**
   * The message for a Docker that cannot be reached.
   *
   * @param error - What asking Docker failed with.
   * @returns The sentence to show.
   */
  static dockerUnavailableMessage(error: unknown): string {
    const detail = errorMessage(error).trim();
    if (detail === "") {
      return "Docker is not reachable; managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.";
    } else {
      return `Docker is not reachable (${detail}); managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.`;
    }
  }

  /** What to say about a Docker that does not answer; only the managed local runtime needs it. */
  static readonly DOCKER = {
    hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
  } as const;

  /**
   * Turns what a start threw into the error the command reports. Anything it
   * does not recognise is returned unchanged for the caller to throw.
   *
   * A start that failed to become ready also carries what cleaning it up did,
   * so a server that could not be stopped is reported as such, and not as a
   * plain start failure. The log tail was read before the failed start was
   * cleaned up, because for a container cleaning up removes the log, which is
   * the only explanation of why it exited.
   *
   * @param error - What the start threw.
   * @param retry - The run to repeat once what stopped it is fixed, as it was typed.
   * @returns The error to throw.
   */
  protected async explain(error: unknown, retry: SuggestedCommand): Promise<unknown> {
    if (error instanceof DockerUnavailableError) {
      return new ZitadelError("E_VALIDATION", "Docker is not reachable", {
        hint: ServerCommand.DOCKER.hint,
        nextCommands: [shellCommand("docker", "version"), retry],
        details: { message: ServerCommand.dockerUnavailableMessage(error.reason) },
      });
    } else if (error instanceof ServerStartError) {
      const { record, details } = error;
      const tail =
        error.logTail === undefined || error.logTail === "" ? {} : { log_tail: error.logTail };
      const reported = new ZitadelError(
        "E_NETWORK",
        error.reason === "exited"
          ? "Local Zitadel server process exited before becoming healthy"
          : "Local Zitadel server did not become healthy",
        {
          hint:
            error.reason === "exited"
              ? "Inspect the local runtime logs, then retry after fixing the startup error."
              : "Inspect the local runtime logs, then reset the local runtime if needed.",
          nextCommands: [{ id: "logs" }, { id: "reset", flags: { force: true } }],
          details: { ...details, server_url: record.server_url, ...tail },
        },
      );

      if (error.cleanup.status === "failed") {
        const startupError = toZitadelError(reported);

        return new ZitadelError(
          startupError.code,
          `${startupError.message}; cleanup did not stop the spawned local runtime`,
          {
            hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel start`.",
            nextCommands: distinct([
              ...(startupError.nextCommands ?? []),
              { id: "stop", flags: { all: true } },
              { id: "logs" },
              { id: "reset", flags: { force: true } },
            ]),
            details: {
              startup_error: {
                code: startupError.code,
                message: startupError.message,
                details: startupError.details,
              },
              stop_result: error.cleanup,
            },
          },
        );
      } else {
        return reported;
      }
    } else if (error instanceof ServerStopError) {
      return new ZitadelError("E_VALIDATION", "Existing local Zitadel server did not stop", {
        hint: "Stop the existing local runtime manually, then rerun start.",
        details: { runtime: error.record, stop_result: error.outcome },
      });
    } else if (error instanceof PortInUseError) {
      const url = LocalRuntime.urlOf(error.port);
      const listeners = await LocalRuntime.listenersOn(error.port, { timeoutMs: 5000 });
      const fallbackPort =
        error.port === LocalRuntime.DEFAULT_PORT ? error.port + 1 : LocalRuntime.DEFAULT_PORT;

      return new ZitadelError("E_PORT_IN_USE", `Port ${String(error.port)} is already in use`, {
        hint: `Stop the process using ${url}, run \`zitadel stop --all\` for managed local runtimes, or choose another port.`,
        nextCommands: [
          { id: "stop", flags: { all: true } },
          { id: "start", flags: { port: fallbackPort } },
        ],
        details: { port: error.port, server_url: url, listeners },
      });
    } else if (error instanceof NoFreePortError) {
      return new ZitadelError("E_PORT_IN_USE", error.message, {
        hint: "Free a port, or choose one with --port.",
        nextCommands: [{ id: "start", flags: { port: 9080 } }],
        details: { first_port: error.firstPort },
      });
    } else {
      return error;
    }
  }
}
