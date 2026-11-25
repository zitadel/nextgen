import {
  DestroyPermit,
  LocalServerOrphansStopError,
  LocalServerPermitMismatchError,
  LocalServerProcessesStopError,
  LocalServerProcessesUnlistableError,
  LocalServerRecordMalformedError,
  LocalServerRecordUnreadableError,
  LocalServerStopError,
} from "@/lib/server";
import { Cmd } from "@/lib/cmd";
import type { CommandResult } from "@/cli/core";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { type Fact, section } from "@/lib/ui";
import { CommandGroups } from "@/cli/commands/groups";
import { Previewable } from "@/cli/core/previewable";
import { Destructive } from "@/cli/core/destructive";
import { LocalServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * What a reset reports about the server it removes: a process, a container, or
 * the container a folder with no record would have had.
 */
type ResetTarget =
  | Readonly<{ backend: "binary"; pid: number; log_path: string }>
  | Readonly<{ backend: "docker" | "missing"; container_name: string }>;

/** How a reset is refused when processes it asked to stop are still running. */
const PROCESSES_DID_NOT_STOP_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
  details: "{details}",
} as const satisfies Refusal;

/** How a reset is refused when the machine cannot list its processes. */
const PROCESSES_UNLISTABLE_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "The local runtime record is damaged and this machine cannot list its processes, so reset cannot tell whether a server still runs on the data. Stop the local Zitadel server yourself, then run `zitadel reset --force` again.",
  details: "{details}",
} as const satisfies Refusal;

/** How a reset is refused when the server is still running afterwards. */
const SERVER_DID_NOT_STOP_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Inspect the local runtime process and stop it manually, then rerun the command.",
  details: "{details}",
} as const satisfies Refusal;

/** How a reset is refused when its permit is for another folder. */
const PERMIT_MISMATCH_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "A reset acts on one folder only. Run it from the folder whose server you mean to reset.",
} as const satisfies Refusal;

/** How a reset is refused when a process on the folder's data is still running. */
const ORPHANS_DID_NOT_STOP_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Inspect the local runtime process and stop it manually, then rerun the command.",
  details: "{details}",
} as const satisfies Refusal;

/** How a reset is refused when the runtime record of this folder is not in the shape it is written in. */
const RECORD_MALFORMED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Run `zitadel reset --force`, then `zitadel start`.",
  details: "{details}",
  next: [
    {
      id: "reset",
      flags: {
        force: true,
      },
    },
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a reset is refused when the runtime record of this folder cannot be read. */
const RECORD_UNREADABLE_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Check that {path} and its directory are readable by you.",
  details: "{details}",
} as const satisfies Refusal;

/**
 * `zitadel reset`: stops and removes this folder's server and deletes its data.
 * A folder with no server is not refused: there is nothing to reset, and the
 * result says so.
 */
export default class Reset extends Telemetered(
  Destructive(
    LocalServerCommand(Previewable(BaseCommand), "exact"),
    "Delete the local runtime and its data without the confirmation prompt. Required when non-interactive.",
  ),
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
        try {
          await this.serverInThisFolder().reset(DestroyPermit.forFolder(this.cwd));
        } catch (error) {
          if (error instanceof LocalServerProcessesStopError) {
            throw refusalError(PROCESSES_DID_NOT_STOP_REFUSAL, {
              message: error.message,
              details: error.details ?? null,
            });
          }
          if (error instanceof LocalServerProcessesUnlistableError) {
            throw refusalError(PROCESSES_UNLISTABLE_REFUSAL, {
              message: error.message,
              details: error.details ?? null,
            });
          }
          if (error instanceof LocalServerStopError) {
            throw refusalError(SERVER_DID_NOT_STOP_REFUSAL, {
              message: error.message,
              details: error.details ?? null,
            });
          }
          if (error instanceof LocalServerPermitMismatchError) {
            throw refusalError(PERMIT_MISMATCH_REFUSAL, {
              message: error.message,
            });
          }
          if (error instanceof LocalServerOrphansStopError) {
            throw refusalError(ORPHANS_DID_NOT_STOP_REFUSAL, {
              message: error.message,
              details: error.details ?? null,
            });
          }
          if (error instanceof LocalServerRecordMalformedError) {
            throw refusalError(RECORD_MALFORMED_REFUSAL, {
              message: error.message,
              details: error.details ?? null,
            });
          }
          if (error instanceof LocalServerRecordUnreadableError) {
            throw refusalError(RECORD_UNREADABLE_REFUSAL, {
              message: error.message,
              details: error.details ?? null,
              path: Cmd.quote(error.path),
            });
          }
          throw error;
        }
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
    // biome-ignore lint/plugin: assigned inside the try that guards the call, read after it
    let record: Awaited<ReturnType<ReturnType<typeof this.serverInThisFolder>["record"]>>;
    try {
      record = await this.serverInThisFolder().record();
    } catch (error) {
      if (error instanceof LocalServerRecordMalformedError) {
        throw refusalError(RECORD_MALFORMED_REFUSAL, {
          message: error.message,
          details: error.details ?? null,
        });
      }
      if (error instanceof LocalServerRecordUnreadableError) {
        throw refusalError(RECORD_UNREADABLE_REFUSAL, {
          message: error.message,
          details: error.details ?? null,
          path: Cmd.quote(error.path),
        });
      }
      throw error;
    }

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
