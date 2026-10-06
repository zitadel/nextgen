import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { ZitadelError } from "../../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { connectTarget } from "../../lib/target";

/**
 * `zitadel projects demote` — make the project `sandbox` again, which lets
 * loopback origins back into a project that may hold real users.
 */
export default class ProjectsDemote extends BaseCommand {
  static override description = "Demote the project to class sandbox.";
  static override group = CommandGroups.resources;
  static override examples = ["<%= config.bin %> projects demote --env production --confirm"];
  static override flags = {
    confirm: Flags.boolean({ description: "Confirm without the prompt. Required when non-interactive." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(ProjectsDemote);
    await this.toMeta(flags);
    const { cwd, env, dryRun, nonInteractive, serverFlag, envName, envFile } = this.meta;
    const { client, projectId } = await connectTarget({ cwd, env, serverFlag, envName, envFile });
    if (dryRun) {
      return this.emit({ status: "skipped", reason: "dry-run", data: { class: "sandbox" } });
    }
    if (!flags.confirm) {
      if (nonInteractive) {
        throw new ZitadelError("E_VALIDATION", "demote needs --confirm when non-interactive");
      }
      const answer = await confirm({ message: "Let loopback origins back into this project?" });
      if (isCancel(answer) || !answer) {
        cancel("Demote cancelled.");
        throw new ZitadelError("E_VALIDATION", "Demote cancelled by user");
      }
    }
    const project = await client.setProjectClass(projectId, { class: "sandbox", confirm: true });
    return this.emit({
      status: "ok",
      data: { id: project.id, class: project.class },
      pretty: `class      production -> ${project.class}`,
    });
  }
}
