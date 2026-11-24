import { Flags } from "@oclif/core";

import { LocalRuntime } from "@/lib/server";
import type { Admitted, CommandResult } from "@/cli/core";
import { type Fact, section } from "@/lib/ui";
import { CommandGroups } from "@/cli/commands/groups";
import { ServerCommand } from "@/cli/commands/server-command";
import { Previewable } from "@/cli/core/previewable";
import { LocalServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";

/**
 * `zitadel stop`: stops this folder's server and keeps its data, or, with
 * `--all`, every server this CLI manages on the machine whichever folder
 * started it. Stopping a folder with no server is not an error: there is
 * nothing to stop, and the result says so.
 */
export default class Stop extends LocalServerCommand(
  Previewable(ServerCommand(BaseCommand)),
  "exact",
) {
  static override description = "Stop the local Zitadel server.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 2;

  static override examples = ["<%= config.bin %> stop", "<%= config.bin %> stop --all"];
  static override flags = {
    all: Flags.boolean({
      description: "Stop all discovered CLI-managed local Zitadel runtime processes.",
    }),
  };

  /**
   * Says what the command would stop, without stopping it.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The result of the dry run.
   */
  protected async preview({ flags }: Admitted<typeof Stop>): Promise<CommandResult> {
    if (flags.all) {
      const discovery = await this.localServers().current();
      const dryRun = dryRunResult({
        verb: "stop",
        topic: "server",
        noun: "host-wide managed local runtime processes",
        warnings: discovery.supported ? [] : ["managed-runtime-processes: discovery unavailable"],
        next: await this.realRun(),
      });

      if (discovery.supported) {
        const found: Fact[] = discovery.processes.map((one): Fact => {
          return ["Process", String(one.pid)];
        });

        return {
          ...dryRun,
          pretty: undefined,
          data: {
            ...(dryRun.data as object),
            sweep: {
              supported: true,
              scope: "host",
              count: discovery.processes.length,
              processes: discovery.processes,
            },
          },
          summary: {
            ...dryRun.summary,
            sections: [section(undefined, ...found)],
          },
        };
      } else {
        return {
          ...dryRun,
          pretty: undefined,
          data: {
            ...(dryRun.data as object),
            sweep: {
              supported: false,
              error: discovery.error,
              processes: [],
            },
          },
          summary: {
            ...dryRun.summary,
            sections: [section(undefined, ["Error", discovery.error ?? "unknown"])],
          },
        };
      }
    }

    const server = this.serverInThisFolder();
    const record = await server.record();
    const dryRun = dryRunResult({
      verb: "stop",
      topic: "server",
      noun: "the local Zitadel server",
      next: await this.realRun(),
    });

    if (record !== undefined && record.backend === "binary") {
      const facts: Fact[] = [
        ["Runtime", "binary"],
        ["Process", String(record.pid)],
        ["Data", record.data_dir],
      ];

      return {
        ...dryRun,
        pretty: undefined,
        data: {
          ...(dryRun.data as object),
          runtime: {
            backend: "binary",
            pid: record.pid,
            log_path: record.log_path,
            data_preserved: true,
            data_dir: record.data_dir,
          },
        },
        summary: {
          ...dryRun.summary,
          sections: [section(undefined, ...facts)],
        },
      };
    } else if (record !== undefined) {
      const facts: Fact[] = [
        ["Runtime", "docker"],
        ["Container", record.container_name],
        ["Data", record.data_dir],
      ];

      return {
        ...dryRun,
        pretty: undefined,
        data: {
          ...(dryRun.data as object),
          runtime: {
            backend: "docker",
            container_name: record.container_name,
            data_preserved: true,
            data_dir: record.data_dir,
          },
        },
        summary: {
          ...dryRun.summary,
          sections: [section(undefined, ...facts)],
        },
      };
    } else {
      const containerName = server.containerName();
      const facts: Fact[] = [
        ["Runtime", "missing"],
        ["Container", containerName],
      ];

      return {
        ...dryRun,
        pretty: undefined,
        data: {
          ...(dryRun.data as object),
          runtime: {
            backend: "missing",
            container_name: containerName,
            data_preserved: true,
            data_dir: undefined,
          },
        },
        summary: {
          ...dryRun.summary,
          sections: [section(undefined, ...facts)],
        },
      };
    }
  }

  /**
   * Stops the local server, or every managed runtime on the host.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The result of the run.
   */
  protected async apply({ flags }: Admitted<typeof Stop>): Promise<CommandResult> {
    if (flags.all) {
      const sweep = await LocalRuntime.stopAll(this.localServers());
      if (!sweep.supported) {
        const title = "Managed local runtime process discovery is unavailable";

        return {
          status: "ok",
          data: {
            title,
            sweep: {
              supported: false,
              error: sweep.error,
              stopped: [],
            },
          },
          summary: {
            title,
            sections: [section(undefined, ["Error", sweep.error ?? "unknown"])],
          },
          warnings: ["managed-runtime-processes: discovery unavailable"],
        };
      }

      if (sweep.results.length === 0) {
        return {
          status: "ok",
          data: {
            title: "No host-wide managed local runtime processes found",
            sweep: {
              supported: true,
              scope: "host",
              count: 0,
              results: sweep.results,
            },
          },
          summary: {
            title: "No host-wide managed local runtime processes found",
            sections: [section(undefined)],
          },
        };
      } else {
        const stopped: Fact[] = sweep.results.map((result): Fact => {
          return ["Process", String(result.process.pid)];
        });

        return {
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
        };
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
      const { stopped, outcome } = await server.stop();
      const title = stopped
        ? "Local Zitadel server stopped"
        : "Local Zitadel server was not running";

      return {
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
        summary: {
          title,
          sections: [section(undefined, ...facts)],
        },
      };
    } else if (record !== undefined) {
      const facts: Fact[] = [
        ["Runtime", "docker"],
        ["Container", record.container_name],
        ["Data", record.data_dir],
      ];
      const { stopped } = await server.stop();
      const title = stopped
        ? "Local Zitadel server stopped"
        : "Local Zitadel server was not running";

      return {
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
        summary: {
          title,
          sections: [section(undefined, ...facts)],
        },
      };
    } else {
      const containerName = server.containerName();
      const facts: Fact[] = [
        ["Runtime", "missing"],
        ["Container", containerName],
      ];
      const { stopped } = await server.stop();
      const title = stopped
        ? "Local Zitadel server stopped"
        : "Local Zitadel server was not running";

      return {
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
        summary: {
          title,
          sections: [section(undefined, ...facts)],
        },
      };
    }
  }
}
