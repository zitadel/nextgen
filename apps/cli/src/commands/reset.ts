import { Flags } from "@oclif/core";

import { localContainerName } from "../lib/local-server/runtime";
import { LocalServer } from "../lib/local-server/server";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { recordedRuntime } from "./local-server/requirements/recorded-runtime";
import { Destructive } from "../lib/oclif/destructive";

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

  static override requires = {
    recorded: recordedRuntime,
  };

  protected async execute({ recorded }: Admitted<typeof Reset>): Promise<JsonEnvelope> {
    const { runtime } = recorded;

    const containerName =
      runtime?.backend === "docker" ? runtime.container_name : localContainerName(this.cwd);
    const described = {
      backend: runtime?.backend ?? "missing",
      ...(runtime?.backend === "binary"
        ? { pid: runtime.pid, log_path: runtime.log_path }
        : { container_name: containerName }),
      data_deleted: true,
    };

    return this.emit(
      await this.confirmed({
        verb: "reset",
        name: "delete the local runtime and its data",
        message: "Delete the local Zitadel runtime and .zitadel/local/nextgen-data?",
        preview: () => ({
          status: "ok",
          data: { title: "Local Zitadel server runtime reset plan.", runtime: described },
          next: { commands: [this.suggestUnscoped("reset --force")] },
        }),
        apply: async (consent) => {
          await LocalServer.at(this.cwd, { cliVersion: this.cliVersion }).reset(consent);
          return {
            status: "ok",
            data: { title: "Local Zitadel server runtime reset.", runtime: described },
          };
        },
      }),
    );
  }
}
