import { Flags } from "@oclif/core";

import { DestroyPermit } from "@/lib/server";
import { LocalServerCommand, ServerCommand } from "@/cli/commands/server-command";
import type { CommandResult, JsonEnvelope } from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";
import { type Fact, section } from "@/lib/ui";
import { BaseCommand } from "@/lib/oclif";
import { CommandGroups } from "@/cli/commands/groups";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * What a reset reports about the server it removes: a process, a container, or
 * the container a folder with no record would have had.
 */
type ResetTarget =
  | Readonly<{ backend: "binary"; pid: number; log_path: string }>
  | Readonly<{ backend: "docker" | "missing"; container_name: string }>;

/**
 * `zitadel reset`: stops and removes this folder's server and deletes its data.
 * A folder with no server is not refused: there is nothing to reset, and the
 * result says so.
 */
export default class Reset extends Telemetered(
  Destructive(LocalServerCommand(ServerCommand(BaseCommand), "exact")),
) {
  static override group = CommandGroups.localServer;
  static override description = "Delete the local Zitadel server runtime and data.";
  static override groupOrder = 6;

  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Delete the local runtime and its data without the confirmation prompt. Required when non-interactive.",
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

  protected async execute(): Promise<JsonEnvelope> {
    const record = await this.serverInThisFolder().record();

    if (record !== undefined && record.backend === "binary") {
      return this.emit(
        await this.confirmedReset(
          { backend: "binary", pid: record.pid, log_path: record.log_path },
          ["Process", String(record.pid)],
        ),
      );
    } else if (record !== undefined) {
      return this.emit(
        await this.confirmedReset({ backend: "docker", container_name: record.container_name }, [
          "Container",
          record.container_name,
        ]),
      );
    } else {
      const containerName = this.serverInThisFolder().containerName();

      return this.emit(
        await this.confirmedReset({ backend: "missing", container_name: containerName }, [
          "Container",
          containerName,
        ]),
      );
    }
  }

  /**
   * Asks for confirmation, then removes the server and its data; a dry run
   * reports what would go instead.
   *
   * @param target - What the reset removes, as the result describes it.
   * @param owner - The line naming what runs the server: its process or its container.
   * @returns The result to emit.
   */
  private confirmedReset(target: ResetTarget, owner: Fact): Promise<CommandResult> {
    const facts = section(undefined, ["Runtime", target.backend], owner);

    return this.confirmed({
      verb: "reset",
      name: "delete the local runtime and its data",
      message: [
        `Permanently delete the local Zitadel server's data in ${this.serverInThisFolder().dataDirectory()}?`,
        "",
        "It stops and removes the local server if one is running, so the status command no longer reports it.",
        "It deletes the server's database: every organization, user, application and setting you created. This cannot be undone.",
        `Kept: ${this.serverInThisFolder().adminFile()}, the local admin sign-in, and everything else in your project.`,
        `Run ${this.suggest({ id: "start" })} afterwards to set up a fresh server.`,
      ].join("\n"),
      preview: async () => {
        const title = "Would reset the local Zitadel server runtime (dry run)";

        return {
          status: "ok",
          data: { dry_run: true, title, runtime: { ...target, data_deleted: false } },
          summary: { title, sections: [facts] },
          next: {
            commands: [await this.again("reset", { without: ["dryRun"], with: { force: true } })],
          },
        };
      },
      apply: async () => {
        await this.serverInThisFolder().reset(DestroyPermit.forFolder(this.cwd));
        const title = "Local Zitadel server runtime reset";

        return {
          status: "ok",
          data: { title, runtime: { ...target, data_deleted: true } },
          summary: { title, sections: [facts] },
        };
      },
    });
  }
}
