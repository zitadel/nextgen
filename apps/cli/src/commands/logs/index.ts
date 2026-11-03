import { Flags } from "@oclif/core";
import { z } from "zod";

import { readNearestRuntimeMetadata } from "../../lib/local-server/runtime";
import { LocalServer } from "../../lib/local-server/server";
import { resolveCwd } from "../../lib/paths";
import { startedServer } from "../local-server/port";
import {
  LOG_LEVELS,
  type LogLine,
  logText,
  renderLogLine,
} from "../../lib/local-server/server-log";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { type Refused, reads, whole } from "../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";

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
 * A flag that holds how many lines to show, {@link DEFAULT_TAIL} of them when
 * it is not given.
 */
export const tailFlag = Flags.custom<number>({
  default: DEFAULT_TAIL,
  parse: reads(TAIL),
});

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
  hint: "Run `zitadel start` first.",
  next: ["start"],
};

export default class Logs extends BaseCommand {
  static override description =
    "Show local Zitadel server logs.\n\nOn a terminal, warnings are yellow and errors red. Run it in the directory `zitadel start` ran in, or one inside it: the server is found from the nearest `.zitadel/local/` on the way up.";
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
    tail: tailFlag({
      description: "Number of lines to show, counting only those --level shows.",
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  private readonly started = startedServer(readNearestRuntimeMetadata);

  protected override async sourceOf(flags: Record<string, unknown>): Promise<string | undefined> {
    const found = await this.started.of(
      resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
    );
    return found?.runtime.server_url;
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
        return this.suggestUnscoped(next);
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
        data: { title: "Stopped following local Zitadel logs." },
      });
    }

    const { runtime, lines } = await server.logs({ tail: flags.tail, level: flags.level });
    return this.emit({
      status: "ok",
      pretty: render(lines, this.isColored),
      data: {
        title: "Local Zitadel server logs.",
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
    });
  }
}

function render(lines: readonly LogLine[], color: boolean): string {
  return lines.map((line) => renderLogLine(line, color)).join("\n");
}
