import { stopBinaryRuntime } from "../lib/local-server/binary";
import { stopAndRemoveContainer } from "../lib/local-server/docker";
import {
  DEFAULT_LOCAL_SERVER_URL,
  localContainerName,
  readRuntimeMetadata,
} from "../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { publicCliCommand } from "../lib/public-cli";

export default class Stop extends BaseCommand {
  static override description = "Stop the local Zitadel server.";

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Stop);
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const runtime = await readRuntimeMetadata(cwd);
    await this.toMeta(flags, {
      resolveServer: false,
      source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
    });

    const containerName =
      runtime?.backend === "docker" ? runtime.container_name : localContainerName(this.meta.cwd);
    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: "Local Zitadel server stop plan.",
          runtime: {
            backend: runtime?.backend ?? "missing",
            ...(runtime?.backend === "binary"
              ? { pid: runtime.pid, log_path: runtime.log_path }
              : { container_name: containerName }),
            data_preserved: true,
            data_dir: runtime?.data_dir,
          },
          next_commands: [publicCliCommand("stop", this.meta.cliVersion)],
        },
      });
    }

    if (runtime?.backend === "binary") {
      await stopBinaryRuntime(runtime.pid);
    } else {
      await stopAndRemoveContainer(containerName);
    }

    return this.emit({
      status: "ok",
      data: {
        title: "Local Zitadel server stopped.",
        runtime: {
          backend: runtime?.backend ?? "missing",
          ...(runtime?.backend === "binary"
            ? { pid: runtime.pid, log_path: runtime.log_path }
            : { container_name: containerName }),
          data_preserved: true,
          data_dir: runtime?.data_dir,
        },
      },
    });
  }
}
