import { DestroyPermit } from "@/lib/server";
import type { CommandResult } from "@/cli/core";
import { type Fact, section } from "@/lib/ui";
import { CommandGroups } from "@/cli/commands/groups";
import { Previewable } from "@/cli/core/previewable";
import { Destructive } from "@/cli/core/destructive";
import { LocalServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";

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
export default class Reset extends Destructive(
  LocalServerCommand(Previewable(BaseCommand), "exact"),
  "Delete the local runtime and its data without the confirmation prompt. Required when non-interactive.",
) {
  static override description = "Delete the local Zitadel server runtime and data.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 6;

  static override examples = ["<%= config.bin %> reset", "<%= config.bin %> reset --force"];

  /**
   * Reports what a reset would remove, without removing anything.
   *
   * @returns The dry run's envelope.
   */
  protected async preview(): Promise<CommandResult> {
    const { target, owner } = await this.targeted();
    const dryRun = dryRunResult({
      verb: "reset",
      topic: "server",
      noun: "the local Zitadel server runtime",
      next: await this.realRun({ force: true }),
    });

    return {
      ...dryRun,
      pretty: undefined,
      data: {
        ...(dryRun.data as object),
        runtime: { ...target, data_deleted: false },
      },
      summary: {
        ...dryRun.summary,
        sections: [section(undefined, ["Runtime", target.backend], owner)],
      },
    };
  }

  /**
   * Asks for confirmation, then removes the server and its data.
   *
   * @returns The envelope of the reset.
   */
  protected async apply(): Promise<CommandResult> {
    const { target, owner } = await this.targeted();
    const facts = section(undefined, ["Runtime", target.backend], owner);

    return await this.confirmed({
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
      apply: async () => {
        await this.serverInThisFolder().reset(DestroyPermit.forFolder(this.cwd));
        const title = "Local Zitadel server runtime reset";

        return {
          status: "ok",
          data: {
            title,
            runtime: { ...target, data_deleted: true },
          },
          summary: {
            title,
            sections: [facts],
          },
        };
      },
    });
  }

  /**
   * What a reset removes, read from the folder's server record.
   *
   * @returns The target as the result describes it, and the line naming what runs the server.
   */
  private async targeted(): Promise<{ target: ResetTarget; owner: Fact }> {
    const record = await this.serverInThisFolder().record();

    if (record !== undefined && record.backend === "binary") {
      return {
        target: {
          backend: "binary",
          pid: record.pid,
          log_path: record.log_path,
        },
        owner: ["Process", String(record.pid)],
      };
    } else if (record !== undefined) {
      return {
        target: { backend: "docker", container_name: record.container_name },
        owner: ["Container", record.container_name],
      };
    } else {
      const containerName = this.serverInThisFolder().containerName();

      return {
        target: { backend: "missing", container_name: containerName },
        owner: ["Container", containerName],
      };
    }
  }
}
