import { Flags } from "@oclif/core";

import { ZitadelError } from "../lib/errors";
import { stopBinaryRuntime, type StopBinaryRuntimeResult } from "../lib/local-server/binary";
import { stopAndRemoveContainer } from "../lib/local-server/docker";
import {
  discoverManagedRuntimeProcesses,
  type ManagedRuntimeProcess,
} from "../lib/local-server/processes";
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
  static override flags = {
    all: Flags.boolean({
      description: "Stop all discovered CLI-managed local Zitadel runtime processes.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Stop);
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const runtime = await readRuntimeMetadata(cwd);
    await this.toMeta(flags, {
      resolveServer: false,
      source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
    });

    if (flags.all) {
      return this.stopAllManagedRuntimes();
    }

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

    let stopResult: StopBinaryRuntimeResult | undefined;
    if (runtime?.backend === "binary") {
      stopResult = await stopBinaryRuntime(runtime.pid);
      if (stopResult.status === "failed") {
        throw new ZitadelError("E_VALIDATION", "Local Zitadel server did not stop", {
          hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel stop`.",
          details: { runtime, stop_result: stopResult },
        });
      }
    } else {
      await stopAndRemoveContainer(containerName);
    }

    return this.emit({
      status: "ok",
      data: {
        title:
          stopResult?.status === "stale"
            ? "Local Zitadel server was not running."
            : "Local Zitadel server stopped.",
        runtime: {
          backend: runtime?.backend ?? "missing",
          ...(runtime?.backend === "binary"
            ? {
                pid: runtime.pid,
                log_path: runtime.log_path,
                stop_result: stopResult,
              }
            : { container_name: containerName }),
          data_preserved: true,
          data_dir: runtime?.data_dir,
        },
      },
    });
  }

  private async stopAllManagedRuntimes(): Promise<JsonEnvelope> {
    const discovery = await discoverManagedRuntimeProcesses();
    if (!discovery.supported) {
      return this.emit({
        status: "ok",
        data: {
          title: "Managed local runtime process discovery is unavailable.",
          sweep: { supported: false, error: discovery.error, stopped: [] },
        },
        warnings: ["managed-runtime-processes: discovery unavailable"],
      });
    }

    const results: ManagedRuntimeSweepResult[] = [];
    for (const processInfo of discovery.processes) {
      results.push({
        process: processInfo,
        stop_result: await stopBinaryRuntime(processInfo.pid),
      });
    }
    const failed = results.filter((result) => result.stop_result.status === "failed");
    if (failed.length > 0) {
      throw new ZitadelError("E_VALIDATION", "Some managed local runtime processes did not stop", {
        hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
        details: { supported: true, results },
      });
    }

    return this.emit({
      status: "ok",
      data: {
        title:
          results.length === 0
            ? "No host-wide managed local runtime processes found."
            : "Host-wide managed local runtime processes stopped.",
        sweep: {
          supported: true,
          scope: "host",
          count: results.length,
          results,
        },
      },
    });
  }
}

type ManagedRuntimeSweepResult = Readonly<{
  process: ManagedRuntimeProcess;
  stop_result: StopBinaryRuntimeResult;
}>;
