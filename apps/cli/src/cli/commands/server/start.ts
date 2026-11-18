import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  DockerUnavailableError,
  LocalRuntime,
  NoFreePortError,
  PortInUseError,
  type RuntimeMetadata,
  ServerStartError,
  ServerStopError,
} from "@/lib/server";
import { LocalServerCommand, ServerCommand } from "@/cli/commands/server-command";
import { type Admitted, type CommandResult, type JsonEnvelope, nonBlankString } from "@/lib/oclif";
import { type Refused, reads, whole } from "@/lib/oclif/flags";
import type { NextSteps } from "@/lib/oclif/next-steps";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { Guidance, shellCommand, type Suggest, type SuggestedCommand } from "@/lib/suggestion";
import { section } from "@/lib/ui";
import { BaseCommand } from "@/lib/oclif";
import { CommandGroups } from "@/cli/commands/groups";
import type { Observation } from "@/cli/telemetry/observation";

/**
 * How an image beside the binary runtime is refused: an image is a container's,
 * and the npm binary runtime has none to run.
 */
const IMAGE_NEEDS_DOCKER_REFUSAL = {
  message: "--image requires --runtime docker",
  hint: "Pass --runtime docker with --image <tag>, or omit --image for the npm binary runtime.",
} as const satisfies Refusal;

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
  next: [{ id: "stop", flags: { all: true } }, "{alternate}"],
  details: { port: "{port}", server_url: "{url}", listeners: "{listeners}" },
} as const satisfies Refusal;

/** How a start is refused when every port it would try is held. */
const NO_FREE_PORT_REFUSAL = {
  code: "E_PORT_IN_USE",
  message: "{message}",
  hint: "Free a port, or choose one with --port.",
  next: [{ id: "start", flags: { port: 9080 } }],
  details: { first_port: "{first}" },
} as const satisfies Refusal;

/** How a start is refused when the server it launched did not become ready. */
const SERVER_NOT_READY_REFUSAL = {
  code: "E_NETWORK",
  message: "{message}",
  hint: "{hint}",
  next: [{ id: "logs" }, { id: "reset", flags: { force: true } }],
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
    { id: "reset", flags: { force: true } },
    { id: "stop", flags: { all: true } },
  ],
  details: {
    startup_error: { code: "E_NETWORK", message: "{message}", details: "{details}" },
    stop_result: "{stop}",
  },
} as const satisfies Refusal;

/** How a start is refused when the server it had to replace would not stop. */
const SERVER_WOULD_NOT_STOP_REFUSAL = {
  message: "Existing local Zitadel server did not stop",
  hint: "Stop the existing local runtime manually, then rerun start.",
  details: { runtime: "{runtime}", stop_result: "{stop}" },
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
export default class Start extends LocalServerCommand(ServerCommand(BaseCommand), "exact") {
  static override group = CommandGroups.localServer;
  static override readonly observation: Observation = { headline: "runtime" };
  static override description = "Start a local Zitadel server.";
  static override groupOrder = 1;

  static override flags = {
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
  };

  protected override async sourceOf(flags: Record<string, unknown>, cwd: string): Promise<string> {
    const plan = await this.serverInThisFolder(cwd).plan({
      port: z.number().optional().catch(undefined).parse(flags.port),
      shell: process.env,
    });

    return plan.apiUrl;
  }

  /**
   * Legacy: `--server` is accepted and ignored, so the run names no server.
   *
   * @returns No server.
   */
  protected override async resolveServer(): Promise<string> {
    return "";
  }

  protected async execute({ flags }: Admitted<typeof Start>): Promise<JsonEnvelope> {
    if (flags.runtime === "binary" && flags.image !== undefined) {
      throw refusalError(IMAGE_NEEDS_DOCKER_REFUSAL, {});
    }

    const server = this.serverInThisFolder();
    const request = {
      port: flags.port,
      backend: flags.runtime,
      image: flags.image,
      shell: this.env,
    };
    const plan = await server.plan(request);
    const { apiUrl, consoleUrl } = plan;
    this.annotate({ runtime: plan.backend });

    if (this.dryRun) {
      const title = "Would start the local Zitadel server (dry run)";
      const urls = { api: apiUrl, console: consoleUrl };
      const next = { commands: [await this.realRun()] };

      if (plan.backend === "docker") {
        return this.emit({
          status: "ok",
          data: {
            dry_run: true,
            title,
            runtime: {
              backend: "docker",
              container_name: plan.containerName,
              image: plan.image,
              port: plan.port,
            },
            urls,
          },
          summary: {
            title,
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
          next,
        });
      } else {
        return this.emit({
          status: "ok",
          data: {
            dry_run: true,
            title,
            runtime: { backend: "binary", port: plan.port },
            urls,
          },
          summary: {
            title,
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
          next,
        });
      }
    } else {
      const retry = await this.again("start", {});
      const { runtime: record, alreadyRunning } = await server
        .launch(request)
        .catch(async (error: unknown) => {
          if (error instanceof DockerUnavailableError) {
            throw refusalError(
              DOCKER_UNAVAILABLE_REFUSAL,
              { detail: error.detail },
              { check: shellCommand("docker", "version"), retry },
            );
          } else if (error instanceof PortInUseError) {
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
              { alternate: this.suggest({ id: "start", flags: { port: alternatePort } }) },
            );
          } else if (error instanceof NoFreePortError) {
            throw refusalError(NO_FREE_PORT_REFUSAL, {
              message: error.message,
              first: error.firstPort,
            });
          } else if (error instanceof ServerStartError) {
            const details = {
              ...error.details,
              server_url: error.record.server_url,
              log_tail: error.logTail || undefined,
            };
            const reason = NOT_READY_REASONS[error.reason];

            if (error.cleanup.status === "failed") {
              throw refusalError(SERVER_NOT_READY_AND_RUNNING_REFUSAL, {
                message: reason.message,
                details,
                stop: error.cleanup,
              });
            } else {
              throw refusalError(SERVER_NOT_READY_REFUSAL, {
                message: reason.message,
                hint: reason.hint,
                details,
              });
            }
          } else if (error instanceof ServerStopError) {
            throw refusalError(SERVER_WOULD_NOT_STOP_REFUSAL, {
              runtime: error.record,
              stop: error.outcome,
            });
          } else {
            throw error;
          }
        });
      this.meta = { ...this.meta, source: record.server_url };

      if (alreadyRunning) {
        return this.emit(started("Local Zitadel server is already running", record, this.suggest));
      } else {
        return this.emit(started("Local Zitadel server is ready", record, this.suggest));
      }
    }
  }
}

/**
 * What a start that ended with a running server reports.
 *
 * @param title - The headline: ready, or already running.
 * @param record - The server's record.
 * @param suggest - Builds the commands to suggest next.
 * @returns The result to emit.
 */
function started(title: string, record: RuntimeMetadata, suggest: Suggest): CommandResult {
  const urls = { api: record.server_url, console: `${record.server_url}/ui/console/` };
  const next: NextSteps<SuggestedCommand> = {
    actions: [
      "Create an app with authentication. Run setup in this directory or a subdirectory.",
      "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
      new Guidance(suggest).serverLog(),
    ],
    commands: [suggest({ id: "setup", flags: { server: "local" } })],
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
