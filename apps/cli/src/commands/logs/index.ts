import { Flags } from "@oclif/core";
import { Suggestible } from "@/lib/oclif/suggestible";
import { z } from "zod";

import { DEFAULT_LOCAL_SERVER_URL, readNearestRuntimeMetadata } from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { startedServer } from "@/commands/local-server/started";
import { LOG_LEVELS, type LogLine, logText, renderLogLine } from "@/lib/local-server/server-log";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { type Refused, reads, whole } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { painted } from "@/lib/oclif/rendering";

/** How many lines `--tail` shows when it is not given. */
const DEFAULT_TAIL = 200;

/**
 * How many lines to show: a whole number of one or more, since a server writes
 * whole lines and zero of them would print nothing. An overflowing count is
 * refused too, because Docker is handed it verbatim and the binary backend
 * reads it as the whole log.
 */
const TAIL: Refused<number> = {
  schema: whole.pipe(z.number().min(1)),
  refusal: {
    message: "{value} is not a valid tail",
    hint: "Use a positive integer.",
  },
};

/**
 * How following the lines into the envelope is refused: following writes lines
 * as the server writes them, which is a stream and never the one envelope
 * `--json` promises.
 */
const FOLLOW_IS_NOT_JSON_REFUSAL: Refusal = {
  message: "Cannot stream logs with --json",
  hint: "Run without --json, or omit --follow.",
};

/** How a directory where `zitadel start` never ran is refused. */
const NOT_STARTED_REFUSAL: Refusal = {
  message: "Local Zitadel runtime has not been started",
  hint: "Start the local server first.",
  next: ["start"],
};

export default class Logs extends Suggestible(BaseCommand) {
  static override description =
    "Show local Zitadel server logs.\n\nOn a terminal, warnings are yellow and errors red. Run it in the directory the start command ran in, or one inside it: the server is found from the nearest .zitadel/local/ on the way up.";

  static override group = CommandGroups.localDevelopment;
  static override groupOrder = 2;

  static override examples = [
    "<%= config.bin %> <%= command.id %> --follow",
    "<%= config.bin %> <%= command.id %> --level warn",
  ];

  static override flags = {
    follow: Flags.boolean({ description: "Keep printing lines as the server writes them." }),
    level: Flags.option({
      description: "Show only lines at this level or above.",
      options: LOG_LEVELS,
    })(),
    tail: Flags.custom<number>({
      parse: reads(TAIL),
    })({
      default: DEFAULT_TAIL,
      description: "Number of lines to show, counting only those --level shows.",
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  private readonly started = startedServer(readNearestRuntimeMetadata);

  protected override async sourceOf(_flags: unknown, cwd: string): Promise<string> {
    // The default where nothing was started here, because a run still reports
    // the server it is about: an empty one would name no server at all.
    return (await this.started.of(cwd))?.runtime.server_url ?? DEFAULT_LOCAL_SERVER_URL;
  }

  protected async execute({ flags }: Admitted<typeof Logs>): Promise<JsonEnvelope> {
    if (flags.follow && this.isJson) {
      throw refusalError(FOLLOW_IS_NOT_JSON_REFUSAL, {});
    }
    // The server this directory uses: the one `zitadel start` ran in here or
    // in the nearest parent, as `doctor` and `console` find it.
    const started = await this.started.of(this.cwd);
    if (started === undefined) {
      throw refusalError(NOT_STARTED_REFUSAL, {}, (next) => {
        return this.suggest(next);
      });
    }
    const server = LocalServer.at(started.dir, {
      cliVersion: this.cliVersion,
    });
    if (flags.follow) {
      await server.followLogs({
        tail: flags.tail,
        level: flags.level,
        print: (lines) => {
          if (lines.length > 0) {
            process.stdout.write(`${render(lines, this.isColored)}\n`);
          }
        },
      });

      return this.emit({
        status: "ok",
        data: { title: "Stopped following local Zitadel logs" },
        summary: {
          title: "Stopped following local Zitadel logs",
          sections: [],
        },
      });
    }

    const { runtime, lines } = await server.logs({ tail: flags.tail, level: flags.level });
    const shown = lines.map((line) => {
      return renderLogLine(line, this.isColored);
    });

    return this.emit({
      status: "ok",
      data: {
        title: "Local Zitadel server logs",
        runtime:
          runtime.backend === "binary"
            ? {
                backend: runtime.backend,
                pid: runtime.pid,
                log_path: runtime.log_path,
              }
            : {
                backend: runtime.backend,
                container_name: runtime.container_name,
              },
        logs: logText(lines),
      },
      pretty: painted(shown.join("\n")),
      summary: {
        title: "Done",
        sections: [],
        lines: shown,
      },
    });
  }
}

function render(lines: readonly LogLine[], color: boolean): string {
  return lines.map((line) => renderLogLine(line, color)).join("\n");
}
