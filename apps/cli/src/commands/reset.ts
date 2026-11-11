import { join } from "node:path";

import { Flags } from "@oclif/core";

import { LOCAL_ADMIN_FILE } from "@/lib/local-server/admin-credential";
import {
  DEFAULT_LOCAL_SERVER_URL,
  localContainerName,
  localRuntimePaths,
  readRuntimeMetadata,
} from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { startedServer } from "./local-server/started";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";

export default class Reset extends Destructive(BaseCommand) {
  static override description = "Delete the local Zitadel server runtime and data.";
  static override group = CommandGroups.localDevelopment;

  static override groupOrder = 4;
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Delete the local runtime and its data without the confirmation prompt. Required when non-interactive.",
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  private readonly started = startedServer(readRuntimeMetadata);

  protected override async sourceOf(_flags: unknown, cwd: string): Promise<string> {
    return (await this.started.of(cwd))?.server_url ?? DEFAULT_LOCAL_SERVER_URL;
  }

  protected async execute(): Promise<JsonEnvelope> {
    // A directory with no server is not refused: there is simply nothing to
    // reset, which the result says.
    const runtime = await this.started.of(this.cwd);

    const containerName =
      runtime?.backend === "docker" ? runtime.container_name : localContainerName(this.cwd);
    const described = {
      backend: runtime?.backend ?? "missing",
      ...(runtime?.backend === "binary"
        ? { pid: runtime.pid, log_path: runtime.log_path }
        : { container_name: containerName }),
      data_deleted: true,
    };

    const dataDir = localRuntimePaths(this.meta.cwd).dataDir;
    const adminFile = join(this.meta.cwd, LOCAL_ADMIN_FILE);

    return this.emit(
      await this.confirmed({
        verb: "reset",
        name: "delete the local runtime and its data",
        message: [
          `Permanently delete the local Zitadel server's data in ${dataDir}?`,
          "",
          "It stops and removes the local server if one is running, so the status command no longer reports it.",
          "It deletes the server's database: every organization, user, application and setting you created. This cannot be undone.",
          `Kept: ${adminFile}, the local admin sign-in, and everything else in your project.`,
          `Run ${this.suggestUnscoped("start")} afterwards to set up a fresh server.`,
        ].join("\n"),
        preview: () => ({
          status: "ok",
          data: { title: "Local Zitadel server runtime reset plan", runtime: described },
          summary: { title: "Local Zitadel server runtime reset plan", sections: [] },
          next: { commands: [this.suggestUnscoped("reset --force")] },
        }),
        apply: async (consent) => {
          await LocalServer.at(this.cwd, { cliVersion: this.cliVersion }).reset(consent);
          return {
            status: "ok",
            data: { title: "Local Zitadel server runtime reset", runtime: described },
            summary: { title: "Local Zitadel server runtime reset", sections: [] },
          };
        },
      }),
    );
  }
}
