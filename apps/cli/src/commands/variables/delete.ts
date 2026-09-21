import { Args, Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { ownerLabel } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { assertVariableName } from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables delete` topic command — remove one variable from one owner.
 *
 * A variable is removable only by the owner that entered it: deleting a name
 * another owner of the same project holds answers `var.not_found` and leaves
 * that owner's value standing (ADR 062 §4). Destructive, so it takes the same
 * `--force`-or-confirm gate the resource commands' `delete` uses.
 */
export default class VariablesDelete extends EnvironmentCommand {
  static override description = "Delete one variable from an environment or the project.";
  static override group = CommandGroups.configuration;
  static override args = {
    name: Args.string({ required: true, description: "Variable name to delete." }),
  };
  static override flags = {
    // `--force` is per command, not global: here it permits a deletion.
    force: Flags.boolean({
      char: "f",
      description:
        "Delete the variable without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariablesDelete);
    await this.toMeta(flags);
    const { cwd, source, nonInteractive, dryRun, force, cliVersion } = this.meta;
    const name = args.name;

    assertVariableName(name);

    const secret = await readZitadelSecret(cwd);
    // Stated to a human, but kept off a pipe: these lines share stdout with the
    // result. The same rule the resource commands follow.
    if (process.stdout.isTTY) {
      consola.info(`Project   ${secret.project_id}`);
      consola.info(`Server    ${source}`);
    }
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    const environment = await this.resolveOwner(client, secret.project_id);
    const where = ownerLabel(environment);

    // A dry run makes no request, so it answers before the guard — the order
    // the resource commands' `delete` uses, which keeps
    // `--dry-run --non-interactive` usable.
    if (dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: `Delete ${name} from ${where}.`,
          environment: environment ?? null,
          name,
          deleted: true,
        },
      });
    }

    if (!force) {
      if (nonInteractive) {
        const retry = publicCliCommand(
          `variables delete ${name} ${environment ? `--environment ${environment}` : "--project-level"} --force`,
          cliVersion,
        );
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
      if (isCancel(answer) || !answer) {
        cancel("Delete cancelled.");
        return this.emit({ status: "skipped", reason: "delete-cancelled" });
      }
    }

    await client.deleteVariable(name, {
      project_id: secret.project_id,
      ...(environment ? { environment_name: environment } : {}),
    });
    this.recordTelemetry({ is_environment_scoped: environment !== undefined });

    return this.emit({
      status: "ok",
      data: { environment: environment ?? null, name, deleted: true },
      pretty: `Deleted ${name} from ${where}`,
    });
  }
}
