import { Args, Flags } from "@oclif/core";
import { confirm, isCancel } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { assertVariableName, environmentParam, ownerLabel } from "../../lib/variables";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables delete` topic command — remove one variable from one owner.
 *
 * A variable is removable only by the owner that entered it: removing a name
 * another owner of the same project holds answers `var.not_found` and leaves
 * that owner's value standing (ADR 062 §4).
 */
export default class VariablesDelete extends BaseCommand {
  static override description = "Delete one variable from an environment or the project.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 7;
  static override args = {
    name: Args.string({ required: true, description: "Variable name to delete." }),
  };
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Environment to delete from. Omit to delete at the project level.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariablesDelete);
    // Which server and which environment are independent: the CLI talks to one
    // instance, and its environments live inside that instance. `--environment`
    // names the owner there, so it is withheld from `toMeta`, which would
    // otherwise pass it to the server resolver and let a `zitadel.json`
    // `environments.<name>.server` entry redirect the request.
    await this.toMeta({ ...flags, environment: undefined });
    const { cwd, source, nonInteractive, dryRun } = this.meta;
    const environment = flags.environment;
    const name = args.name;

    assertVariableName(name);
    const owner = environmentParam(environment);
    const where = environment ?? "the project";

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project       ${secret.project_id}`);
    consola.info(`Server        ${source}`);
    consola.info(`Environment   ${ownerLabel(environment)}`);

    if (!nonInteractive) {
      const ok = await confirm({ message: `Delete ${name} from ${where}?` });
      if (isCancel(ok) || !ok) {
        return this.emit({
          status: "skipped",
          reason: "cancelled",
          data: { environment: environment ?? null, name },
        });
      }
    }
    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { environment: environment ?? null, name },
      });
    }

    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    await client.deleteVariable(name, { project_id: secret.project_id, ...owner });
    this.recordTelemetry({ scoped: environment !== undefined });

    return this.emit({
      status: "ok",
      data: { environment: environment ?? null, name },
      pretty: `Deleted ${name} from ${where}`,
    });
  }
}
