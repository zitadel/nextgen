import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  LocalRuntime,
  LocalServerDockerMissingError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerStartCleanupFailedError,
  LocalServerStartExitedError,
  LocalServerStartFailedError,
  LocalServerStartTimeoutError,
  LocalServerStopError,
} from "@/lib/server";
import { type Admitted, type CommandResult, nonBlankString } from "@/cli/core";
import { reads, type Refused, whole } from "@/cli/core/flags";
import type { NextSteps } from "@/cli/core/next-steps";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { Guidance, shellCommand, type SuggestedCommand } from "@/lib/suggestion";
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
  details: {
    first_port: "{firstPort}",
  },
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
    stop_result: "{stopResult}",
  },
} as const satisfies Refusal;

/** How a start is refused when the server it had to replace would not stop. */
const SERVER_WOULD_NOT_STOP_REFUSAL = {
  message: "Existing local Zitadel server did not stop",
  hint: "Stop the existing local runtime manually, then rerun start.",
  details: {
    runtime: "{runtime}",
    stop_result: "{stopResult}",
  },
} as const satisfies Refusal;

/** What a server that launched but did not become ready is reported as, by why. */
const NOT_READY_REASONS = {
  exited: {
    message: "Local Zitadel server process exited before becoming healthy",
    hint: "Inspect the local runtime logs, then retry after fixing the startup error.",
  },
  timeout: {
    message: "Local Zitadel server did not become healthy",
    hint: "Inspect the local runtime logs, then reset the local runtime if needed.",
  },
} as const;

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
      port: z.number().safeParse(flags.port).data,
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
    try {
      const started = await server.launch(request);
      const { runtime: record, alreadyRunning } = started;
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
    } catch (error) {
      if (error instanceof LocalServerDockerMissingError) {
        throw refusalError(
          DOCKER_UNAVAILABLE_REFUSAL,
          {
            ...error,
            message: error.message,
          },
          {
            check: shellCommand("docker", "version"),
            retry,
          },
        );
      }
      if (error instanceof LocalServerPortBusyError) {
        const [alternatePort] = [LocalRuntime.DEFAULT_PORT, error.port + 1].filter((port) => {
          return port !== error.port;
        });

        throw refusalError(
          PORT_IN_USE_REFUSAL,
          {
            ...error,
            message: error.message,
            port: error.port,
            url: LocalRuntime.urlOf(error.port),
            listeners: await this.machine().listeners(error.port, {
              timeoutMs: 5000,
            }),
          },
          {
            alternate: this.suggest({
              id: "start",
              flags: {
                port: alternatePort,
              },
            }),
          },
        );
      }
      if (error instanceof LocalServerPortFullError) {
        throw refusalError(NO_FREE_PORT_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof LocalServerStartFailedError) {
        // What identifies the server and what it logged, as main reported them.
        const details = Object.fromEntries(
          Object.entries({
            runtime: error.runtime,
            pid: error.pid,
            log_path: error.logPath,
            container_name: error.containerName,
            server_url: error.serverUrl,
            log_tail: error.logTail || undefined,
          }).filter(([, value]) => {
            return value !== undefined;
          }),
        );
        if (error instanceof LocalServerStartCleanupFailedError) {
          throw refusalError(SERVER_NOT_READY_AND_RUNNING_REFUSAL, {
            message: NOT_READY_REASONS[error.reason].message,
            details,
            stopResult: error.stopResult,
          });
        }
        if (error instanceof LocalServerStartExitedError) {
          throw refusalError(SERVER_NOT_READY_REFUSAL, {
            ...NOT_READY_REASONS.exited,
            details,
          });
        }
        if (error instanceof LocalServerStartTimeoutError) {
          throw refusalError(SERVER_NOT_READY_REFUSAL, {
            ...NOT_READY_REASONS.timeout,
            details,
          });
        }
      }
      if (error instanceof LocalServerStopError) {
        throw refusalError(SERVER_WOULD_NOT_STOP_REFUSAL, {
          ...error,
          message: error.message,
          runtime: error.runtime ?? {},
          stopResult: error.stopResult ?? {},
        });
      }
      throw error;
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
