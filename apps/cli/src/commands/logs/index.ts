import { Flags } from "@oclif/core";

import { LocalServer } from "../../lib/local-server/server";
import {
  LOG_LEVELS,
  type LogLine,
  logText,
  renderLogLine,
} from "../../lib/local-server/server-log";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { localRuntimeStarted } from "../local-server/requirements/local-runtime-started";
import { DEFAULT_TAIL, tailFlag } from "./flags/tail";
import { followIsNotJsonRule } from "./rules/follow-is-not-json";

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
      default: DEFAULT_TAIL,
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  static override rules = [followIsNotJsonRule];

  static override requires = {
    started: localRuntimeStarted,
  };

  protected async execute({ flags, started }: Admitted<typeof Logs>): Promise<JsonEnvelope> {
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
