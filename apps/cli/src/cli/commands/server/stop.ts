import { Flags } from "@oclif/core";

import { LocalRuntime } from "@/lib/server";
import { LocalServerCommand, ServerCommand } from "@/cli/commands/server-command";
import type { Admitted, JsonEnvelope } from "@/lib/oclif";
import { type Fact, section } from "@/lib/ui";
import { BaseCommand } from "@/lib/oclif";
import { CommandGroups } from "@/cli/commands/groups";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * `zitadel stop`: stops this folder's server and keeps its data, or, with
 * `--all`, every server this CLI manages on the machine whichever folder
 * started it. Stopping a folder with no server is not an error: there is
 * nothing to stop, and the result says so.
 */
export default class Stop extends Telemetered(LocalServerCommand(ServerCommand(BaseCommand), "exact")) {
  static override group = CommandGroups.localServer;
  static override description = "Stop the local Zitadel server.";
  static override groupOrder = 2;

  static override flags = {
    all: Flags.boolean({
      description: "Stop all discovered CLI-managed local Zitadel runtime processes.",
    }),
  };

  /**
   * Legacy: `--server` is accepted and ignored, so the run names no server.
   *
   * @returns No server.
   */
  protected override async resolveServer(): Promise<string> {
    return "";
  }

  protected async execute({ flags }: Admitted<typeof Stop>): Promise<JsonEnvelope> {
    if (flags.all) {
      if (this.dryRun) {
        const discovery = await this.localServers().current();
        const title = "Would stop host-wide managed local runtime processes (dry run)";

        if (discovery.supported) {
          const found: Fact[] = discovery.processes.map((one): Fact => {
            return ["Process", String(one.pid)];
          });

          return this.emit({
            status: "ok",
            data: {
              dry_run: true,
              title,
              sweep: {
                supported: true,
                scope: "host",
                count: discovery.processes.length,
                processes: discovery.processes,
              },
            },
            summary: { title, sections: [section(undefined, ...found)] },
            next: { commands: [this.suggest({ id: "stop", flags: { all: true } })] },
          });
        } else {
          return this.emit({
            status: "ok",
            data: {
              dry_run: true,
              title,
              sweep: { supported: false, error: discovery.error, processes: [] },
            },
            summary: {
              title,
              sections: [section(undefined, ["Error", discovery.error ?? "unknown"])],
            },
            next: { commands: [this.suggest({ id: "stop", flags: { all: true } })] },
            warnings: ["managed-runtime-processes: discovery unavailable"],
          });
        }
      }

      const sweep = await LocalRuntime.stopAll(this.localServers());
      if (!sweep.supported) {
        const title = "Managed local runtime process discovery is unavailable";

        return this.emit({
          status: "ok",
          data: { title, sweep: { supported: false, error: sweep.error, stopped: [] } },
          summary: { title, sections: [section(undefined, ["Error", sweep.error ?? "unknown"])] },
          warnings: ["managed-runtime-processes: discovery unavailable"],
        });
      }

      if (sweep.results.length === 0) {
        return this.emit({
          status: "ok",
          data: {
            title: "No host-wide managed local runtime processes found",
            sweep: { supported: true, scope: "host", count: 0, results: sweep.results },
          },
          summary: {
            title: "No host-wide managed local runtime processes found",
            sections: [section(undefined)],
          },
        });
      } else {
        const stopped: Fact[] = sweep.results.map((result): Fact => {
          return ["Process", String(result.process.pid)];
        });

        return this.emit({
          status: "ok",
          data: {
            title: "Host-wide managed local runtime processes stopped",
            sweep: {
              supported: true,
              scope: "host",
              count: sweep.results.length,
              results: sweep.results,
            },
          },
          summary: {
            title: "Host-wide managed local runtime processes stopped",
            sections: [section(undefined, ...stopped)],
          },
        });
      }
    }

    const server = this.serverInThisFolder();
    const record = await server.record();

    if (record !== undefined && record.backend === "binary") {
      const facts: Fact[] = [
        ["Runtime", "binary"],
        ["Process", String(record.pid)],
        ["Data", record.data_dir],
      ];

      if (this.dryRun) {
        const title = "Would stop the local Zitadel server (dry run)";

        return this.emit({
          status: "ok",
          data: {
            dry_run: true,
            title,
            runtime: {
              backend: "binary",
              pid: record.pid,
              log_path: record.log_path,
              data_preserved: true,
              data_dir: record.data_dir,
            },
          },
          summary: { title, sections: [section(undefined, ...facts)] },
          next: { commands: [await this.realRun()] },
        });
      } else {
        const { stopped, outcome } = await server.stop();
        const title = this.stoppedTitle(stopped);

        return this.emit({
          status: "ok",
          data: {
            title,
            runtime: {
              backend: "binary",
              pid: record.pid,
              log_path: record.log_path,
              stop_result: outcome,
              data_preserved: true,
              data_dir: record.data_dir,
            },
          },
          summary: { title, sections: [section(undefined, ...facts)] },
        });
      }
    } else if (record !== undefined) {
      const facts: Fact[] = [
        ["Runtime", "docker"],
        ["Container", record.container_name],
        ["Data", record.data_dir],
      ];

      if (this.dryRun) {
        const title = "Would stop the local Zitadel server (dry run)";

        return this.emit({
          status: "ok",
          data: {
            dry_run: true,
            title,
            runtime: {
              backend: "docker",
              container_name: record.container_name,
              data_preserved: true,
              data_dir: record.data_dir,
            },
          },
          summary: { title, sections: [section(undefined, ...facts)] },
          next: { commands: [await this.realRun()] },
        });
      } else {
        const { stopped } = await server.stop();
        const title = this.stoppedTitle(stopped);

        return this.emit({
          status: "ok",
          data: {
            title,
            runtime: {
              backend: "docker",
              container_name: record.container_name,
              data_preserved: true,
              data_dir: record.data_dir,
            },
          },
          summary: { title, sections: [section(undefined, ...facts)] },
        });
      }
    } else {
      const containerName = server.containerName();
      const facts: Fact[] = [
        ["Runtime", "missing"],
        ["Container", containerName],
      ];

      if (this.dryRun) {
        const title = "Would stop the local Zitadel server (dry run)";

        return this.emit({
          status: "ok",
          data: {
            dry_run: true,
            title,
            runtime: {
              backend: "missing",
              container_name: containerName,
              data_preserved: true,
              data_dir: undefined,
            },
          },
          summary: { title, sections: [section(undefined, ...facts)] },
          next: { commands: [await this.realRun()] },
        });
      } else {
        const { stopped } = await server.stop();
        const title = this.stoppedTitle(stopped);

        return this.emit({
          status: "ok",
          data: {
            title,
            runtime: {
              backend: "missing",
              container_name: containerName,
              data_preserved: true,
              data_dir: undefined,
            },
          },
          summary: { title, sections: [section(undefined, ...facts)] },
        });
      }
    }
  }

  /**
   * What the result calls the outcome.
   *
   * @param stopped - Whether there was a running server to stop.
   * @returns The headline: stopped, or that nothing was running.
   */
  private stoppedTitle(stopped: boolean): string {
    if (stopped) {
      return "Local Zitadel server stopped";
    } else {
      return "Local Zitadel server was not running";
    }
  }
}
