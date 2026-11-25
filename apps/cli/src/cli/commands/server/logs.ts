import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  LocalRuntime,
  LocalServerDockerFailedError,
  LocalServerNotStartedError,
} from "@/lib/server";
import { LocalServerCommand } from "@/cli/commands/server-command";
import type { Admitted, CommandResult } from "@/cli/core";
import { reads, type Refused, whole } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { painted, prose } from "@/lib/oclif/rendering";
import { CommandGroups } from "@/cli/commands/groups";
import { Telemetered } from "@/cli/telemetry/telemetered";
import { Output } from "@/lib/ui";
import { BaseCommand } from "@/cli/core";
import { relatedFlags } from "@/lib/suggestion/relations";

/** How many lines `--tail` shows when it is not given. */
const DEFAULT_TAIL = 200;

/**
 * How many lines to show: a whole number of one or more, since a server writes
 * whole lines and zero of them would print nothing. An overflowing count is
 * refused too, because Docker is handed it verbatim and the binary backend
 * reads it as the whole log.
 */
const TAIL = {
  schema: whole.pipe(z.number().min(1)),
  refusal: {
    message: "{value} is not a valid tail",
    hint: "Use a positive integer.",
  },
} as const satisfies Refused<number>;

/**
 * How following the lines into the envelope is refused when JSON mode came from
 * the environment, which `--follow` and `--json` as typed are kept apart by the
 * flags' own relation: following writes lines as the server writes them, which
 * is a stream and never the one envelope JSON mode promises.
 */
const FOLLOW_IS_NOT_JSON_REFUSAL = {
  message: "Cannot stream logs in JSON mode",
  hint: "Unset ZITADEL_CONTENT_TYPE, or omit --follow.",
} as const satisfies Refusal;

/** How a directory where `zitadel start` never ran is refused. */
const NOT_STARTED_REFUSAL = {
  message: "Local Zitadel runtime has not been started",
  hint: "Start the local server first.",
  next: [{ id: "start" }],
} as const satisfies Refusal;

/** How a runtime that was never started is refused. */
const RUNTIME_NOT_STARTED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Run `zitadel start` first.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a failed Docker call is refused. */
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

/**
 * `zitadel logs`: shows the end of the nearest server's log, or follows it as
 * the server writes. On a terminal, warnings are yellow and errors red. Run it
 * in the folder `start` ran in, or one inside it: the server is found from the
 * nearest `.zitadel/local/` on the way up.
 */
export default class Logs extends Telemetered(LocalServerCommand(BaseCommand, "nearest")) {
  static override description =
    "Show local Zitadel server logs.\n\nOn a terminal, warnings are yellow and errors red. Run it in the directory the start command ran in, or one inside it: the server is found from the nearest .zitadel/local/ on the way up.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> logs --follow",
    "<%= config.bin %> logs --level warn",
  ];
  static override flags = relatedFlags(
    {
      follow: Flags.boolean({ description: "Keep printing lines as the server writes them." }),
      level: Flags.option({
        description: "Show only lines at this level or above.",
        options: LocalRuntime.LOG_LEVELS,
      })(),
      tail: Flags.custom<number>({
        parse: reads(TAIL),
      })({
        default: DEFAULT_TAIL,
        description: "Number of lines to show, counting only those --level shows.",
      }),
    },
    { follow: { exclusive: ["json"] } },
  );

  /**
   * Shows the end of the nearest server's log, or follows it as it is written.
   *
   * @param input.flags - The run's `--follow`, `--level` and `--tail`.
   * @returns The lines shown.
   * @throws {ZitadelError} When following under `--json`, or when no server was started here.
   */
  protected async execute({ flags }: Admitted<typeof Logs>): Promise<CommandResult> {
    if (flags.follow && Output.json) {
      throw refusalError(FOLLOW_IS_NOT_JSON_REFUSAL, {});
    }

    const server = await this.serverInNearestFolder();
    if (server === undefined) {
      throw refusalError(NOT_STARTED_REFUSAL, {});
    }

    if (flags.follow) {
      try {
        await server.follow({
          tail: flags.tail,
          level: flags.level,
          print: (lines) => {
            if (!lines.isEmpty) {
              process.stdout.write(`${lines.drawn(Output.color).join("\n")}\n`);
            }
          },
          signal: this.signal,
        });
      } catch (error) {
        if (error instanceof LocalServerNotStartedError) {
          throw refusalError(RUNTIME_NOT_STARTED_REFUSAL, {
            message: error.message,
          });
        }
        if (error instanceof LocalServerDockerFailedError) {
          throw refusalError(DOCKER_FAILED_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
          });
        }
        throw error;
      }

      const title = "Stopped following local Zitadel logs";
      if (Output.screen) {
        return {
          status: "ok",
          data: { title },
          summary: {
            title,
            sections: [],
          },
        };
      } else {
        return {
          status: "ok",
          data: { title },
          pretty: prose(""),
          summary: {
            title,
            sections: [],
          },
        };
      }
    } else {
      try {
        const { runtime, lines } = await server.logs({ tail: flags.tail, level: flags.level });
        const shown = lines.drawn(Output.color);
        const title = "Local Zitadel server logs";

        if (runtime.backend === "binary") {
          return {
            status: "ok",
            data: {
              title,
              runtime: {
                backend: runtime.backend,
                pid: runtime.pid,
                log_path: runtime.log_path,
              },
              logs: lines.text(),
            },
            pretty: painted(shown.join("\n")),
            summary: {
              title,
              sections: [],
              lines: shown,
            },
          };
        } else {
          return {
            status: "ok",
            data: {
              title,
              runtime: { backend: runtime.backend, container_name: runtime.container_name },
              logs: lines.text(),
            },
            pretty: painted(shown.join("\n")),
            summary: {
              title,
              sections: [],
              lines: shown,
            },
          };
        }
      } catch (error) {
        if (error instanceof LocalServerNotStartedError) {
          throw refusalError(RUNTIME_NOT_STARTED_REFUSAL, {
            message: error.message,
          });
        }
        if (error instanceof LocalServerDockerFailedError) {
          throw refusalError(DOCKER_FAILED_REFUSAL, {
            message: error.message,
            details: error.details ?? null,
          });
        }
        throw error;
      }
    }
  }
}
