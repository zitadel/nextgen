import { Flags } from "@oclif/core";

import { ZitadelError } from "../lib/errors";
import { stopBinaryRuntime } from "../lib/local-server/binary";
import { stopAndRemoveContainer } from "../lib/local-server/docker";
import {
  DEFAULT_LOCAL_SERVER_URL,
  localContainerName,
  readRuntimeMetadata,
  removeLocalData,
  removeRuntimeMetadata,
} from "../lib/local-server/runtime";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { nextCommandsData } from "../lib/oclif/envelope";

export default class Reset extends BaseCommand {
  static override description = "Delete the local Zitadel server runtime and data.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 5;
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Delete the local runtime and its data without the confirmation prompt.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Reset);
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
          title: "Local Zitadel server runtime reset plan.",
          runtime: {
            backend: runtime?.backend ?? "missing",
            ...(runtime?.backend === "binary"
              ? { pid: runtime.pid, log_path: runtime.log_path }
              : { container_name: containerName }),
            data_deleted: true,
          },
          ...nextCommandsData([this.suggestUnscoped("reset --force")]),
        },
      });
    }

    const confirmed = await this.input({
      kind: "confirm",
      name: "delete the local runtime and its data",
      message: "Delete the local Zitadel runtime and .zitadel/local/nextgen-data?",
      retry: this.suggestUnscoped("reset --force"),
    });
    if (!confirmed) {
      return this.emit({ status: "skipped", reason: "reset-cancelled" });
    }

    if (runtime?.backend === "binary") {
      const stopResult = await stopBinaryRuntime(runtime.pid);
      if (stopResult.status === "failed") {
        throw new ZitadelError("E_VALIDATION", "Local Zitadel server did not stop", {
          hint: "Stop the local runtime manually, then rerun reset.",
          details: { runtime, stop_result: stopResult },
        });
      }
    } else {
      await stopAndRemoveContainer(containerName);
    }
    await removeLocalData(this.meta.cwd);
    await removeRuntimeMetadata(this.meta.cwd);

    return this.emit({
      status: "ok",
      data: {
        title: "Local Zitadel server runtime reset.",
        runtime: {
          backend: runtime?.backend ?? "missing",
          ...(runtime?.backend === "binary"
            ? { pid: runtime.pid, log_path: runtime.log_path }
            : { container_name: containerName }),
          data_deleted: true,
        },
      },
    });
  }
}
