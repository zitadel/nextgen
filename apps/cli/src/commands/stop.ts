import { Flags } from "@oclif/core";

import {
  DEFAULT_LOCAL_SERVER_URL,
  localContainerName,
  readRuntimeMetadata,
} from "../lib/local-server/runtime";
import { LocalServer } from "../lib/local-server/server";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { nextCommandsData } from "../lib/oclif/envelope";

export default class Stop extends BaseCommand {
  static override description = "Stop the local Zitadel server.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 2;
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
          ...nextCommandsData([this.suggestUnscoped("stop")]),
        },
      });
    }

    const { stopped, outcome } = await LocalServer.at(this.meta.cwd, {
      cliVersion: this.meta.cliVersion,
    }).stop();

    return this.emit({
      status: "ok",
      data: {
        title: stopped ? "Local Zitadel server stopped." : "Local Zitadel server was not running.",
        runtime: {
          backend: runtime?.backend ?? "missing",
          ...(runtime?.backend === "binary"
            ? {
                pid: runtime.pid,
                log_path: runtime.log_path,
                stop_result: outcome,
              }
            : { container_name: containerName }),
          data_preserved: true,
          data_dir: runtime?.data_dir,
        },
      },
    });
  }

  private async stopAllManagedRuntimes(): Promise<JsonEnvelope> {
    const sweep = await LocalServer.stopAll(this.localServers());
    if (!sweep.supported) {
      return this.emit({
        status: "ok",
        data: {
          title: "Managed local runtime process discovery is unavailable.",
          sweep: { supported: false, error: sweep.error, stopped: [] },
        },
        warnings: ["managed-runtime-processes: discovery unavailable"],
      });
    }

    return this.emit({
      status: "ok",
      data: {
        title:
          sweep.results.length === 0
            ? "No host-wide managed local runtime processes found."
            : "Host-wide managed local runtime processes stopped.",
        sweep: {
          supported: true,
          scope: "host",
          count: sweep.results.length,
          results: sweep.results,
        },
      },
    });
  }
}
