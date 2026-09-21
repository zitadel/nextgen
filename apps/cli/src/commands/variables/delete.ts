import { Args, Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { assertVariableName, environmentParam, ownerLabel } from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables delete` topic command — remove one variable from one owner.
 *
 * A variable is removable only by the owner that entered it: deleting a name
 * another owner of the same project holds answers `var.not_found` and leaves
 * that owner's value standing (ADR 062 §4). Destructive, so it takes the same
 * `--force`-or-confirm gate `reset` uses.
 */
export default class VariablesDelete extends BaseCommand {
  static override description = "Delete one variable from an environment or the project.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 8;
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
    // Which server and which environment are independent: the CLI talks to one
    // instance, and its environments live inside that instance. `--environment`
    // names the owner there, so it is withheld from `toMeta`, which would
    // otherwise pass it to the server resolver and let a `zitadel.json`
    // `environments.<name>.server` entry redirect the request.
    const { args, flags } = await this.parse(VariablesDelete);
    await this.toMeta({ ...flags, environment: undefined });
    const { cwd, source, nonInteractive, dryRun, force, cliVersion } = this.meta;
    const environment = flags.environment;
    const name = args.name;

    assertVariableName(name);
    const owner = environmentParam(environment);
    const where = ownerLabel(environment);
    const retry = publicCliCommand(
      `variables delete ${name}${environment ? ` --environment ${environment}` : ""} --force`,
      cliVersion,
    );

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project   ${secret.project_id}`);
    consola.info(`Server    ${source}`);

    if (dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: `Delete ${name} from ${where}.`,
          environment: environment ?? null,
          name,
          deleted: true,
          next_commands: [retry],
        },
      });
    }

    if (!force) {
      if (nonInteractive) {
        throw new ZitadelError(
          "E_VALIDATION",
          "Deleting a variable requires --force in non-interactive mode",
          {
            hint: `Pass --force to delete ${name} from ${where}.`,
            nextCommands: [retry],
          },
        );
      }
      const answer = await confirm({
        message: `Delete ${name} from ${where}?`,
        initialValue: false,
      });
      if (isCancel(answer)) {
        cancel("Delete cancelled.");
        throw new ZitadelError("E_VALIDATION", "Delete cancelled by user");
      }
      if (!answer) {
        return this.emit({ status: "skipped", reason: "delete-cancelled" });
      }
    }

    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    await client.deleteVariable(name, { project_id: secret.project_id, ...owner });
    this.recordTelemetry({ is_environment_scoped: environment !== undefined });

    return this.emit({
      status: "ok",
      data: { environment: environment ?? null, name, deleted: true },
      pretty: `Deleted ${name} from ${where}`,
    });
  }
}
