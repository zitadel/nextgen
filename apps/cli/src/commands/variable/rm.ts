import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { ZitadelError } from "../../lib/errors";
import { assertVariableName, variableScope } from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";

/**
 * `zitadel variable rm NAME` — remove one variable from the project.
 *
 * `--preview` removes the override a preview deploy prefers and leaves the frozen
 * value standing; without it the frozen value is removed. Destructive, so it
 * takes the same `--force`-or-confirm gate the resource commands' `rm` uses.
 */
export default class VariableRm extends EnvironmentCommand {
  static override description = "Remove one variable from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable rm GOOGLE_CLIENT_ID",
    "<%= config.bin %> variable rm API_URL --preview",
    "<%= config.bin %> variable rm GOOGLE_CLIENT_ID --force",
  ];
  static override args = {
    name: nonBlankArg({ required: true, description: "Variable name to remove." }),
  };
  static override flags = {
    preview: Flags.boolean({
      default: false,
      description: "Remove the preview override instead of the value every deploy freezes.",
    }),
    // `--force` is per command, not global: here it permits a removal.
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the variable without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariableRm);
    await this.toMeta(flags);
    const { nonInteractive, dryRun, force, cliVersion } = this.meta;
    const name = args.name;

    assertVariableName(name);

    const { client, projectId } = await this.connect();
    const scope = variableScope(projectId, flags.preview);

    // A dry run makes no request, so it answers before the guard — the order
    // the resource commands' `rm` uses, which keeps `--dry-run
    // --non-interactive` usable.
    if (dryRun) {
      const preview = dryRunResult("remove", "variable", name);
      return this.emit({
        ...preview,
        data: { ...(preview.data as object), applies_to: flags.preview ? "preview" : "all" },
        pretty: `${preview.pretty} from the project${flags.preview ? " (preview)" : ""}`,
      });
    }

    if (!force) {
      if (nonInteractive) {
        const retry = publicCliCommand(
          `variable rm ${name}${flags.preview ? " --preview" : ""} --force${this.environmentSelector()}`,
          cliVersion,
        );
        throw new ZitadelError(
          "E_VALIDATION",
          "Removing a variable requires --force in non-interactive mode",
          {
            hint: `Pass --force to remove ${name} from the project.`,
            nextCommands: [retry],
          },
        );
      }
      const answer = await confirm({
        message: `Remove ${name} from the project?`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel("Remove cancelled.");
        return this.emit({ status: "skipped", reason: "remove-cancelled" });
      }
    }

    await client.deleteVariable(name, scope);

    return this.emit({
      status: "ok",
      data: { name, deleted: true, applies_to: flags.preview ? "preview" : "all" },
      pretty: `Removed ${name} from the project${flags.preview ? " (preview)" : ""}`,
    });
  }
}
