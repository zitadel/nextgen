import { Flags } from "@oclif/core";

import {
  DEFAULT_LOCAL_SERVER_URL,
  localContainerName,
  readRuntimeMetadata,
} from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { startedServer } from "./local-server/started";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";

export default class Stop extends BaseCommand {
  static override description = "Stop the local Zitadel server.";
  static override group = CommandGroups.localDevelopment;

  static override groupOrder = 3;
  static override flags = {
    all: Flags.boolean({
      description: "Stop all discovered CLI-managed local Zitadel runtime processes.",
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  private readonly started = startedServer(readRuntimeMetadata);

  protected override async sourceOf(_flags: unknown, cwd: string): Promise<string> {
    return (await this.started.of(cwd))?.server_url ?? DEFAULT_LOCAL_SERVER_URL;
  }

  protected async execute({ flags }: Admitted<typeof Stop>): Promise<JsonEnvelope> {
    // A directory with no server is not refused: there is simply nothing to
    // stop, which the result says.
    const runtime = await this.started.of(this.cwd);

    if (flags.all) {
      return this.stopAllManagedRuntimes();
    }

    const containerName =
      runtime?.backend === "docker" ? runtime.container_name : localContainerName(this.cwd);
    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          title: "Would stop the local Zitadel server (dry run)",
          runtime: {
            backend: runtime?.backend ?? "missing",
            ...(runtime?.backend === "binary"
              ? { pid: runtime.pid, log_path: runtime.log_path }
              : { container_name: containerName }),
            data_preserved: true,
            data_dir: runtime?.data_dir,
          },
        },
        summary: { title: "Would stop the local Zitadel server (dry run)", sections: [] },
        next: { commands: [this.suggestUnscoped("stop")] },
      });
    }

    const { stopped, outcome } = await LocalServer.at(this.cwd, {
      cliVersion: this.cliVersion,
    }).stop();

    const said = stopped ? "Local Zitadel server stopped" : "Local Zitadel server was not running";

    return this.emit({
      status: "ok",
      data: {
        title: said,
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
      summary: { title: said, sections: [] },
    });
  }

  private async stopAllManagedRuntimes(): Promise<JsonEnvelope> {
    const sweep = await LocalServer.stopAll(this.localServers());
    if (!sweep.supported) {
      return this.emit({
        status: "ok",
        data: {
          title: "Managed local runtime process discovery is unavailable",
          sweep: { supported: false, error: sweep.error, stopped: [] },
        },
        summary: {
          title: "Managed local runtime process discovery is unavailable",
          sections: [],
        },
        warnings: ["managed-runtime-processes: discovery unavailable"],
      });
    }

    const said =
      sweep.results.length === 0
        ? "No host-wide managed local runtime processes found"
        : "Host-wide managed local runtime processes stopped";

    return this.emit({
      status: "ok",
      data: {
        title: said,
        sweep: {
          supported: true,
          scope: "host",
          count: sweep.results.length,
          results: sweep.results,
        },
      },
      summary: { title: said, sections: [] },
    });
  }
}
