import { Flags } from "@oclif/core";

import { localRuntimeStarted } from "../lib/oclif/requires/local-server";
import { LocalServer } from "../lib/local-server/server";
import { LOG_LEVELS, type LogLine, logText, renderLogLine } from "../lib/local-server/server-log";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  excludes,
  integerFlag,
  type JsonEnvelope,
} from "../lib/oclif";

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
    level: Flags.string({
      description: "Show only lines at this level or above.",
      options: [...LOG_LEVELS],
    }),
    tail: integerFlag({
      description: "Number of lines to show, counting only those --level shows.",
      default: 200,
      min: 1,
      refusal: {
        message: "{value} is not a valid tail",
        hint: "Use a positive integer.",
      },
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  static override rules = [
    excludes("follow", "json", {
      message: "Cannot stream logs with --json",
      hint: "Run without --json, or omit --follow.",
    }),
  ];

  static override requires = {
    started: localRuntimeStarted,
  };

  protected async execute({ flags, started }: Admitted<typeof Logs>): Promise<JsonEnvelope> {
    const { tail } = flags;
    const level = LOG_LEVELS.find((name) => name === flags.level);
    const color = colorsLines(flags.color, this.meta.env, Boolean(process.stdout.isTTY));
    const server = LocalServer.at(started.dir, { cliVersion: this.meta.cliVersion });
    if (flags.follow) {
      await server.followLogs({
        tail,
        level,
        print: (lines) => {
          if (lines.length > 0) {
            process.stdout.write(`${render(lines, color)}\n`);
          }
        },
      });
      return this.emit({
        status: "ok",
        data: { title: "Stopped following local Zitadel logs." },
      });
    }

    const { runtime, lines } = await server.logs({ tail, level });
    return this.emit({
      status: "ok",
      pretty: render(lines, color),
      data: {
        title: "Local Zitadel server logs.",
        runtime:
          runtime.backend === "binary"
            ? { backend: runtime.backend, pid: runtime.pid, log_path: runtime.log_path }
            : { backend: runtime.backend, container_name: runtime.container_name },
        logs: logText(lines),
      },
    });
  }
}

function render(lines: readonly LogLine[], color: boolean): string {
  return lines.map((line) => renderLogLine(line, color)).join("\n");
}

/**
 * Whether the lines are printed in color: on a terminal, unless `--no-color`
 * or `NO_COLOR` turns color off, and anywhere `--color` or `FORCE_COLOR` turns
 * it on, such as in a pipe (`bin/run.js` sets the variables from the flags).
 */
export function colorsLines(flag: boolean, env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (!flag || env.NO_COLOR) {
    return false;
  }
  return Boolean(env.FORCE_COLOR) || (isTTY && env.TERM !== "dumb");
}
