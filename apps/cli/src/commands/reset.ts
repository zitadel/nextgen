import { cancel, confirm, isCancel } from "@clack/prompts";

import { ZitadelError } from "../lib/errors";
import { stopAndRemoveContainer } from "../lib/local-server/docker";
import {
  DEFAULT_LOCAL_SERVER_URL,
  localContainerName,
  readRuntimeMetadata,
  removeLocalData,
  removeRuntimeMetadata,
} from "../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { publicCliCommand } from "../lib/public-cli";

export default class Reset extends BaseCommand {
  static override description = "Delete the local Zitadel server runtime and data.";

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Reset);
    const runtime = await readRuntimeMetadata(flags.cwd ? String(flags.cwd) : process.cwd());
    await this.toMeta(flags, {
      resolveServer: false,
      source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
    });

    const containerName = runtime?.container_name ?? localContainerName(this.meta.cwd);
    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: "Local Zitadel server runtime reset plan.",
          runtime: {
            container_name: containerName,
            data_deleted: true,
          },
          next_commands: [publicCliCommand("reset --force", this.meta.cliVersion)],
        },
      });
    }

    if (!this.meta.force) {
      if (this.meta.nonInteractive) {
        throw new ZitadelError("E_VALIDATION", "Reset requires --force in non-interactive mode", {
          hint: "Pass --force to delete `.zitadel/local/nextgen-data`.",
          nextCommands: [publicCliCommand("reset --force", this.meta.cliVersion)],
        });
      }
      const answer = await confirm({
        message: "Delete the local Zitadel container and .zitadel/local/nextgen-data?",
        initialValue: false,
      });
      if (isCancel(answer)) {
        cancel("Reset cancelled.");
        throw new ZitadelError("E_VALIDATION", "Reset cancelled by user");
      }
      if (!answer) {
        return this.emit({ status: "skipped", reason: "reset-cancelled" });
      }
    }

    await stopAndRemoveContainer(containerName);
    await removeLocalData(this.meta.cwd);
    await removeRuntimeMetadata(this.meta.cwd);

    return this.emit({
      status: "ok",
      data: {
        title: "Local Zitadel server runtime reset.",
        runtime: {
          container_name: containerName,
          data_deleted: true,
        },
      },
    });
  }
}
