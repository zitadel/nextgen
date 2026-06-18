import { Flags } from "@oclif/core";

import { ZitadelError } from "../lib/errors";
import { binaryLogs, followBinaryLogs } from "../lib/local-server/binary";
import { containerLogs, followContainerLogs } from "../lib/local-server/docker";
import { DEFAULT_LOCAL_SERVER_URL, readRuntimeMetadata } from "../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { publicCliCommand } from "../lib/public-cli";

export default class Logs extends BaseCommand {
  static override description = "Show local Zitadel server logs.";
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
      if (runtime.backend === "binary") {
        await followBinaryLogs(runtime.log_path, tail);
      } else {
        await followContainerLogs(runtime.container_name, tail);
      }
      return this.emit({
        status: "ok",
        data: { title: "Stopped following local Zitadel logs." },
      });
    }

    const logs =
      runtime.backend === "binary"
        ? await binaryLogs(runtime.log_path, tail)
        : await containerLogs(runtime.container_name, tail);
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
