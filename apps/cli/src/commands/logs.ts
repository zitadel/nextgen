import { Flags } from "@oclif/core";

import { ZitadelError } from "../lib/errors";
import { containerLogs, followContainerLogs } from "../lib/local-server/docker";
import { DEFAULT_LOCAL_SERVER_URL, readRuntimeMetadata } from "../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { publicCliCommand } from "../lib/public-cli";

export default class Logs extends BaseCommand {
  static override description = "Show local Zitadel server logs.";
  static override flags = {
    follow: Flags.boolean({ description: "Follow logs." }),
    tail: Flags.integer({ description: "Number of lines to show.", default: 200 }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Logs);
    const runtime = await readRuntimeMetadata(flags.cwd ? String(flags.cwd) : process.cwd());
    await this.toMeta(flags, {
      resolveServer: false,
      source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
    });

    if (!runtime) {
      throw new ZitadelError("E_VALIDATION", "Local Zitadel runtime has not been started", {
        hint: "Run `zitadel start` first.",
        nextCommands: [publicCliCommand("start", this.meta.cliVersion)],
      });
    }

    const tail = flags.tail ?? 200;
    if (!Number.isInteger(tail) || tail < 1) {
      throw new ZitadelError("E_VALIDATION", `Invalid tail value ${String(tail)}`, {
        hint: "Use a positive integer.",
      });
    }

    if (flags.follow) {
      if (this.jsonEnabled()) {
        throw new ZitadelError("E_VALIDATION", "Cannot stream logs with --json", {
          hint: "Run without --json, or omit --follow.",
        });
      }
      await followContainerLogs(runtime.container_name, tail);
      return this.emit({
        status: "ok",
        data: { title: "Stopped following local Zitadel logs." },
      });
    }

    const logs = await containerLogs(runtime.container_name, tail);
    return this.emit({
      status: "ok",
      pretty: logs.trimEnd(),
      data: {
        title: "Local Zitadel server logs.",
        container_name: runtime.container_name,
        logs,
      },
    });
  }
}
