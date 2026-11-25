import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  LocalRuntime,
  LocalServerAdminFileMalformedError,
  LocalServerAdminPlatformMissingError,
  LocalServerBinaryBlockedError,
  LocalServerBinaryMissingError,
  LocalServerBusyError,
  LocalServerDockerFailedError,
  LocalServerDockerMissingError,
  LocalServerFileUnreadableError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerRecordMalformedError,
  LocalServerStartExitedError,
  LocalServerStartTimeoutError,
  LocalServerStopError,
} from "@/lib/server";
import { type Admitted, type CommandResult, nonBlankString } from "@/cli/core";
import { reads, type Refused, whole } from "@/cli/core/flags";
import type { NextSteps } from "@/cli/core/next-steps";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { PM } from "@/lib/pm";
import { CliPackage } from "@/lib/upgrade";
import {
  Guidance,
  shellCommand,
  type SuggestedCommand,
  suggestedCommandOf,
} from "@/lib/suggestion";
import { relatedFlags } from "@/lib/suggestion/relations";
import { section } from "@/lib/ui";
import { CommandGroups } from "@/cli/commands/groups";
import { Previewable } from "@/cli/core/previewable";
import { LocalServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { Telemetered } from "@/cli/telemetry/telemetered";

const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * A TCP port, refusing what is not a whole number from 1 to 65535, which is no
 * port a server can listen on.
 */
const PORT = {
  schema: whole.pipe(z.number().min(MIN_PORT).max(MAX_PORT)),
  refusal: {
    message: "{value} is not a TCP port",
    hint: "Use a TCP port from {min} to {max}.",
  },
  values: {
    min: MIN_PORT,
    max: MAX_PORT,
  },
} as const satisfies Refused<number>;

/** How a start of the local server is refused: LocalServerDockerFailedError. */
const DOCKER_FAILED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Check that Docker is installed, running, and reachable from this shell.",
  details: "{details}",
  next: [
    {
      id: "doctor",
    },
  ],
} as const satisfies Refusal;

/** How a start is refused when Docker, which a Docker start needs, does not answer. */
const DOCKER_UNAVAILABLE_REFUSAL = {
  message: "Docker is not reachable",
  hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
  next: ["{check}", "{retry}"],
  details: {
    message:
      "Docker is not reachable ({detail}); managed local runtime commands need Docker, but remote or cloud setup can continue with --server <url>.",
  },
} as const satisfies Refusal;

/** How a start is refused when the port it was asked for is held. */
const PORT_IN_USE_REFUSAL = {
  code: "E_PORT_IN_USE",
  message: "Port {port} is already in use",
  hint: "Stop the process using {url}, run `zitadel stop --all` for managed local runtimes, or choose another port.",
  next: [
    {
      id: "stop",
      flags: { all: true },
    },
    "{alternate}",
  ],
  details: {
    port: "{port}",
    server_url: "{url}",
    listeners: "{listeners}",
  },
} as const satisfies Refusal;

/** How a start is refused when every port it would try is held. */
const NO_FREE_PORT_REFUSAL = {
  code: "E_PORT_IN_USE",
  message: "{message}",
  hint: "Free a port, or choose one with --port.",
  next: [
    {
      id: "start",
      flags: { port: 9080 },
    },
  ],
  details: { first_port: "{first}" },
} as const satisfies Refusal;

/** How a start is refused when the server it launched did not become ready. */
const SERVER_NOT_READY_REFUSAL = {
  code: "E_NETWORK",
  message: "{message}",
  hint: "{hint}",
  next: [
    { id: "logs" },
    {
      id: "reset",
      flags: { force: true },
    },
  ],
  details: "{details}",
} as const satisfies Refusal;

/**
 * How a start is refused when the server did not become ready and stopping it
 * failed too, so it may still be running with nothing recording it.
 */
const SERVER_NOT_READY_AND_RUNNING_REFUSAL = {
  code: "E_NETWORK",
  message: "{message}; cleanup did not stop the spawned local runtime",
  hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel start`.",
  next: [
    { id: "logs" },
    {
      id: "reset",
      flags: { force: true },
    },
    {
      id: "stop",
      flags: { all: true },
    },
  ],
  details: {
    startup_error: {
      code: "E_NETWORK",
      message: "{message}",
      details: "{details}",
    },
    stop_result: "{stop}",
  },
} as const satisfies Refusal;

/** How a start is refused when the server it had to replace would not stop. */
const SERVER_WOULD_NOT_STOP_REFUSAL = {
  message: "Existing local Zitadel server did not stop",
  hint: "Stop the existing local runtime manually, then rerun start.",
  details: { runtime: "{runtime}", stop_result: "{stop}" },
} as const satisfies Refusal;

/** How a start of the local server is refused: LocalServerBinaryMissingError. */
const BINARY_MISSING_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
  details: "{details}",
  next: ["{reinstall}"],
} as const satisfies Refusal;

/** How a start of the local server is refused: LocalServerBinaryBlockedError. */
const BINARY_BLOCKED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Check that the server binary exists and can be run, or reinstall @zitadel/cli.",
  details: "{details}",
  next: ["{reinstall}"],
} as const satisfies Refusal;

/** How a start of the local server is refused: LocalServerBusyError. */
const START_IN_PROGRESS_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Wait for it to finish, or delete {lock_file} if no start is running.",
  details: "{details}",
} as const satisfies Refusal;

/** How a start of the local server is refused: LocalServerRecordMalformedError. */
const RECORD_MALFORMED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Run `zitadel reset --force`, then `zitadel start`.",
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

/** How a start of the local server is refused: LocalServerAdminPlatformMissingError. */
const PLATFORM_MISSING_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
  details: "{details}",
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
 * `zitadel start`: starts this folder's server, or finds it already running.
 * The envelope's `source` names the port the run asked for before a server
 * exists, and the port it actually got afterwards, so an agent that follows it
 * targets the server that was started.
 */
export default class Start extends Telemetered(
  LocalServerCommand(Previewable(BaseCommand), "exact"),
) {
  static override description = "Start a local Zitadel server.";
  static override group = CommandGroups.localServer;
  static override readonly headline = "runtime";
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> start",
    "<%= config.bin %> start --port 8080",
    "<%= config.bin %> start --runtime docker",
  ];
  static override flags = relatedFlags(
    {
      image: nonBlankString({ description: "Container image to run." }),
      port: Flags.custom<number>({
        parse: reads(PORT),
      })({
        description:
          "Local HTTP port. By default this directory keeps the port it had, or takes the first free one from 8080.",
      }),
      runtime: Flags.option({
        description: "Local runtime backend.",
        options: LocalRuntime.BACKENDS,
      })(),
    },
    {
      image: {
        excludedWhen: {
          flags: ["runtime"],
          when: (flags: Record<string, unknown>) => {
            return flags.runtime === "binary";
          },
        },
      },
    },
  );

  /**
   * The server a start is about: the one this folder's plan names, known before
   * the run has a context so that every event and refusal names it.
   *
   * @param flags - The flags as parsed.
   * @param cwd - The directory the run addresses.
   * @returns The API URL of the planned server.
   */
  protected override async sourceOf(flags: Record<string, unknown>, cwd: string): Promise<string> {
    const plan = await this.serverInThisFolder(cwd).plan({
      port: z.number().optional().catch(undefined).parse(flags.port),
      shell: process.env,
    });

    return plan.apiUrl;
  }

  /**
   * Says what the command would do, without doing it.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The result of the dry run.
   */
  protected async preview({ flags }: Admitted<typeof Start>): Promise<CommandResult> {
    const { plan } = await this.planned(flags);
    const { apiUrl, consoleUrl } = plan;
    const dryRun = dryRunResult({
      verb: "start",
      topic: "server",
      noun: "the local Zitadel server",
      next: await this.realRun(),
    });
    const urls = { api: apiUrl, console: consoleUrl };

    if (plan.backend === "docker") {
      return {
        ...dryRun,
        pretty: undefined,
        data: {
          ...(dryRun.data as object),
          runtime: {
            backend: "docker",
            container_name: plan.containerName,
            image: plan.image,
            port: plan.port,
          },
          urls,
        },
        summary: {
          ...dryRun.summary,
          sections: [
            section(
              undefined,
              ["Runtime", "docker"],
              ["Image", plan.image],
              ["Port", String(plan.port)],
              ["API", apiUrl],
              ["Console", consoleUrl],
            ),
          ],
        },
      };
    } else {
      return {
        ...dryRun,
        pretty: undefined,
        data: {
          ...(dryRun.data as object),
          runtime: { backend: "binary", port: plan.port },
          urls,
        },
        summary: {
          ...dryRun.summary,
          sections: [
            section(
              undefined,
              ["Runtime", "binary"],
              ["Port", String(plan.port)],
              ["API", apiUrl],
              ["Console", consoleUrl],
            ),
          ],
        },
      };
    }
  }

  /**
   * Starts the local server, or says it is already running, and reports the
   * server that is running either way.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The result of the run.
   */
  protected async apply({ flags }: Admitted<typeof Start>): Promise<CommandResult> {
    const { server, request } = await this.planned(flags);
    const retry = await this.again("start", {});
    const { runtime: record, alreadyRunning } = await server
      .launch(request)
      .catch((error: unknown) => {
        if (error instanceof LocalServerDockerMissingError) {
          throw refusalError(
            DOCKER_UNAVAILABLE_REFUSAL,
            { detail: error.detail },
            {
              check: shellCommand("docker", "version"),
              retry,
            },
          );
        }
        throw error;
      })
      .catch(async (error: unknown) => {
        if (error instanceof LocalServerPortBusyError) {
          const [alternatePort] = [LocalRuntime.DEFAULT_PORT, error.port + 1].filter((port) => {
            return port !== error.port;
          });

          throw refusalError(
            PORT_IN_USE_REFUSAL,
            {
              port: error.port,
              url: LocalRuntime.urlOf(error.port),
              listeners: await this.machine().listeners(error.port, { timeoutMs: 5000 }),
            },
            {
              alternate: this.suggest({
                id: "start",
                flags: { port: alternatePort },
              }),
            },
          );
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerPortFullError) {
          throw refusalError(NO_FREE_PORT_REFUSAL, {
            message: error.message,
            first: error.firstPort,
          });
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerStartExitedError) {
          const details = {
            ...error.details,
            server_url: error.record.server_url,
            log_tail: error.logTail || undefined,
          };

          if (error.cleanup.status === "failed") {
            throw refusalError(SERVER_NOT_READY_AND_RUNNING_REFUSAL, {
              message: "Local Zitadel server process exited before becoming healthy",
              details,
              stop: error.cleanup,
            });
          } else {
            throw refusalError(SERVER_NOT_READY_REFUSAL, {
              message: "Local Zitadel server process exited before becoming healthy",
              hint: "Inspect the local runtime logs, then retry after fixing the startup error.",
              details,
            });
          }
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerStartTimeoutError) {
          const details = {
            ...error.details,
            server_url: error.record.server_url,
            log_tail: error.logTail || undefined,
          };

          if (error.cleanup.status === "failed") {
            throw refusalError(SERVER_NOT_READY_AND_RUNNING_REFUSAL, {
              message: "Local Zitadel server did not become healthy",
              details,
              stop: error.cleanup,
            });
          } else {
            throw refusalError(SERVER_NOT_READY_REFUSAL, {
              message: "Local Zitadel server did not become healthy",
              hint: "Inspect the local runtime logs, then reset the local runtime if needed.",
              details,
            });
          }
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerStopError) {
          throw refusalError(SERVER_WOULD_NOT_STOP_REFUSAL, {
            runtime: error.record ?? null,
            stop: error.outcome ?? null,
          });
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerBinaryMissingError) {
          throw refusalError(
            BINARY_MISSING_REFUSAL,
            {
              message: error.message,
              details: error.details ?? null,
            },
            {
              reinstall: suggestedCommandOf(PM.named("npm").add([`${CliPackage.NAME}@latest`])),
            },
          );
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerBinaryBlockedError) {
          throw refusalError(
            BINARY_BLOCKED_REFUSAL,
            {
              message: error.message,
              details: error.details ?? null,
            },
            {
              reinstall: suggestedCommandOf(PM.named("npm").add([`${CliPackage.NAME}@latest`])),
            },
          );
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerBusyError) {
          throw refusalError(START_IN_PROGRESS_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
            lock_file: String(error.details?.lock_file ?? ""),
          });
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerRecordMalformedError) {
          throw refusalError(RECORD_MALFORMED_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
          });
        }
        throw error;
      })
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
        if (error instanceof LocalServerAdminPlatformMissingError) {
          throw refusalError(PLATFORM_MISSING_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
          });
        }
        throw error;
      })
      .catch((error: unknown) => {
        if (error instanceof LocalServerDockerFailedError) {
          throw refusalError(DOCKER_FAILED_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
          });
        }
        throw error;
      });
    this.meta = { ...this.meta, source: record.server_url };

    const title = alreadyRunning
      ? "Local Zitadel server is already running"
      : "Local Zitadel server is ready";
    const urls = {
      api: record.server_url,
      console: `${record.server_url}/ui/console/`,
    };
    const next: NextSteps<SuggestedCommand> = {
      actions: [
        "Create an app with authentication. Run setup in this directory or a subdirectory.",
        "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
        new Guidance(this.suggest).serverLog(),
      ],
      commands: [
        this.suggest({
          id: "setup",
          flags: { server: "local" },
        }),
      ],
    };

    if (record.backend === "binary") {
      return {
        status: "ok",
        data: {
          title,
          runtime: {
            backend: "binary",
            pid: record.pid,
            log_path: record.log_path,
            server_package: record.server_package,
            server_version: record.server_version,
            port: record.port,
            data_dir: record.data_dir,
            env: record.env ?? LocalRuntime.NO_ENV,
          },
          urls,
        },
        summary: {
          title,
          sections: [
            section(
              undefined,
              ["Process", String(record.pid)],
              ["API", urls.api],
              ["Console", urls.console],
              ["Data", record.data_dir],
            ),
          ],
        },
        next,
      };
    } else {
      return {
        status: "ok",
        data: {
          title,
          runtime: {
            backend: "docker",
            container_name: record.container_name,
            container_id: record.container_id,
            image: record.image,
            port: record.port,
            data_dir: record.data_dir,
            env: record.env ?? LocalRuntime.NO_ENV,
          },
          urls,
        },
        summary: {
          title,
          sections: [
            section(
              undefined,
              ["Container", record.container_name],
              ["API", urls.api],
              ["Console", urls.console],
              ["Data", record.data_dir],
            ),
          ],
        },
        next,
      };
    }
  }

  /**
   * Refuses a runtime the image does not fit and plans the local server, which
   * both a dry run and a start begin with.
   *
   * @param flags - The flags the command accepts.
   * @returns The server of this folder, the request that starts it, and the plan.
   */
  private async planned(flags: Admitted<typeof Start>["flags"]) {
    const server = this.serverInThisFolder();
    const request = {
      port: flags.port,
      backend: flags.runtime,
      image: flags.image,
      shell: this.env,
    };
    const plan = await server.plan(request);
    this.annotate({ runtime: plan.backend });

    return {
      server,
      request,
      plan,
    };
  }
}
