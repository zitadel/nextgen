import { Args, Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { ownerLabel } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { ZitadelError } from "../../lib/errors";
import { assertVariableName } from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";

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
  static override examples = [
    "<%= config.bin %> variables delete GOOGLE_CLIENT_ID --environment prod",
    "<%= config.bin %> variables delete GOOGLE_CLIENT_ID --project-level --force",
  ];
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
    const { nonInteractive, dryRun, force, cliVersion } = this.meta;
    const name = args.name;

    assertVariableName(name);

    const { client, scope, environment } = await this.connect();
    const where = ownerLabel(environment);

    // A dry run makes no request, so it answers before the guard — the order
    // the resource commands' `delete` uses, which keeps
    // `--dry-run --non-interactive` usable.
    if (dryRun) {
      // The resource commands' dry-run contract, so an agent reads one shape
      // for every preview; `deleted` is reserved for a deletion that happened.
      const preview = dryRunResult("delete", "variables", name);
      return this.emit({
        ...preview,
        data: { ...(preview.data as object), environment: environment ?? null },
        pretty: `${preview.pretty} from ${where}`,
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

    await client.deleteVariable(name, scope);
    this.recordTelemetry({ is_environment_scoped: environment !== undefined });

    return this.emit({
      status: "ok",
      data: { environment: environment ?? null, name, deleted: true },
      pretty: `Deleted ${name} from ${where}`,
    });
  }
}
