import { Flags } from "@oclif/core";

import { ZitadelError } from "../lib/errors";
import { DEFAULT_LOCAL_SERVER_URL, readRuntimeMetadata } from "../lib/local-server/runtime";
import { LocalServer } from "../lib/local-server/server";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";

export default class Logs extends BaseCommand {
  static override description = "Show local Zitadel server logs.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 4;
  static override flags = {
    follow: Flags.boolean({ description: "Follow logs." }),
    tail: Flags.integer({ description: "Number of lines to show.", default: 200 }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Logs);
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const runtime = await readRuntimeMetadata(cwd);
    await this.toMeta(flags, {
      resolveServer: false,
      source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
    });

    if (!runtime) {
      throw new ZitadelError("E_VALIDATION", "Local Zitadel runtime has not been started", {
        hint: "Run `zitadel start` first.",
        nextCommands: [this.suggestUnscoped("start")],
      });
    }

    const tail = flags.tail ?? 200;
    if (!Number.isInteger(tail) || tail < 1) {
      throw new ZitadelError("E_VALIDATION", `Invalid tail value ${String(tail)}`, {
        hint: "Use a positive integer.",
      });
    }

    const server = LocalServer.at(this.meta.cwd, { cliVersion: this.meta.cliVersion });
    if (flags.follow) {
      if (this.jsonEnabled()) {
        throw new ZitadelError("E_VALIDATION", "Cannot stream logs with --json", {
          hint: "Run without --json, or omit --follow.",
        });
      }
      await server.logs({ tail, follow: true });
      return this.emit({
        status: "ok",
        data: { title: "Stopped following local Zitadel logs." },
      });
    }

    const { logs } = await server.logs({ tail });
    return this.emit({
      status: "ok",
      pretty: logs.trimEnd(),
      data: {
        title: "Local Zitadel server logs.",
        runtime:
          runtime.backend === "binary"
            ? { backend: runtime.backend, pid: runtime.pid, log_path: runtime.log_path }
            : { backend: runtime.backend, container_name: runtime.container_name },
        logs,
      },
    });
  }
}
