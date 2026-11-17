import { Flags } from "@oclif/core";
import { z } from "zod";

import { LocalRuntime, type RuntimeMetadata } from "@/lib/server";
import { ServerCommand } from "@/cli/commands/server/base";
import { type Admitted, type CommandResult, type JsonEnvelope, nonBlankString } from "@/lib/oclif";
import { type Refused, reads, whole } from "@/lib/oclif/flags";
import type { NextSteps } from "@/lib/oclif/next-steps";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { Guidance, type Suggest, type SuggestedCommand } from "@/lib/suggestion";
import { section } from "@/lib/ui";

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

/**
 * `zitadel start`: starts this folder's server, or finds it already running.
 * The envelope's `source` names the port the run asked for before a server
 * exists, and the port it actually got afterwards, so an agent that follows it
 * targets the server that was started.
 */
export default class Start extends ServerCommand {
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
      port: typeof flags.port === "number" ? flags.port : undefined,
      shell: process.env,
    });

    return LocalRuntime.urlOf(plan.port);
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
    const apiUrl = LocalRuntime.urlOf(plan.port);
    const consoleUrl = `${apiUrl}/ui/console/`;
    this.recordTelemetry({ runtime: plan.backend });

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
        .catch(async (error) => {
          throw await this.explain(error, retry);
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
