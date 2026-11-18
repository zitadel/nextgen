import { Flags } from "@oclif/core";
import { z } from "zod";

import { LocalRuntime } from "@/lib/server";
import { LocalServerCommand, ServerCommand } from "@/cli/commands/server-command";
import type { Admitted, JsonEnvelope } from "@/lib/oclif";
import { reads, type Refused, whole } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { painted, prose } from "@/lib/oclif/rendering";
import { BaseCommand } from "@/lib/oclif";
import { CommandGroups } from "@/cli/commands/groups";
import { Telemetered } from "@/cli/telemetry/telemetered";

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
 * How following the lines into the envelope is refused: following writes lines
 * as the server writes them, which is a stream and never the one envelope
 * `--json` promises.
 */
const FOLLOW_IS_NOT_JSON_REFUSAL = {
  message: "Cannot stream logs with --json",
  hint: "Run without --json, or omit --follow.",
} as const satisfies Refusal;

/** How a directory where `zitadel start` never ran is refused. */
const NOT_STARTED_REFUSAL = {
  message: "Local Zitadel runtime has not been started",
  hint: "Start the local server first.",
  next: [{ id: "start" }],
} as const satisfies Refusal;

/**
 * `zitadel logs`: shows the end of the nearest server's log, or follows it as
 * the server writes. On a terminal, warnings are yellow and errors red. Run it
 * in the folder `start` ran in, or one inside it: the server is found from the
 * nearest `.zitadel/local/` on the way up.
 */
export default class Logs extends Telemetered(LocalServerCommand(ServerCommand(BaseCommand), "nearest")) {
  static override group = CommandGroups.localServer;
  static override description =
    "Show local Zitadel server logs.\n\nOn a terminal, warnings are yellow and errors red. Run it in the directory the start command ran in, or one inside it: the server is found from the nearest .zitadel/local/ on the way up.";
  static override groupOrder = 4;

  static override examples = [
    "<%= config.bin %> <%= command.id %> --follow",
    "<%= config.bin %> <%= command.id %> --level warn",
  ];
  static override flags = {
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
  };

  /**
   * Legacy: `--server` is accepted and ignored, so the run names no server.
   *
   * @returns No server.
   */
  protected override async resolveServer(): Promise<string> {
    return "";
  }

  protected async execute({ flags }: Admitted<typeof Logs>): Promise<JsonEnvelope> {
    if (flags.follow && this.isJson) {
      throw refusalError(FOLLOW_IS_NOT_JSON_REFUSAL, {});
    }

    const server = await this.serverInNearestFolder();
    if (server === undefined) {
      throw refusalError(NOT_STARTED_REFUSAL, {});
    }

    if (flags.follow) {
      await server.follow({
        tail: flags.tail,
        level: flags.level,
        print: (lines) => {
          if (!lines.isEmpty) {
            process.stdout.write(`${lines.drawn(this.isColored).join("\n")}\n`);
          }
        },
        signal: this.signal,
      });

      const title = "Stopped following local Zitadel logs";
      if (this.isOnScreen) {
        return this.emit({
          status: "ok",
          data: { title },
          summary: { title, sections: [] },
        });
      } else {
        return this.emit({
          status: "ok",
          data: { title },
          pretty: prose(""),
          summary: { title, sections: [] },
        });
      }
    } else {
      const { runtime, lines } = await server.logs({ tail: flags.tail, level: flags.level });
      const shown = lines.drawn(this.isColored);
      const title = "Local Zitadel server logs";

      if (runtime.backend === "binary") {
        return this.emit({
          status: "ok",
          data: {
            title,
            runtime: { backend: runtime.backend, pid: runtime.pid, log_path: runtime.log_path },
            logs: lines.text(),
          },
          pretty: painted(shown.join("\n")),
          summary: { title, sections: [], lines: shown },
        });
      } else {
        return this.emit({
          status: "ok",
          data: {
            title,
            runtime: { backend: runtime.backend, container_name: runtime.container_name },
            logs: lines.text(),
          },
          pretty: painted(shown.join("\n")),
          summary: { title, sections: [], lines: shown },
        });
      }
    }
  }
}
