import { Flags } from "@oclif/core";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { deletedData } from "../../lib/oclif/envelope";
import { assertVariableName, variableScope } from "../../lib/variables";
import { Promptable } from "../../lib/oclif/promptable";

/**
 * `zitadel variable rm NAME` — remove one variable from the project.
 *
 * `--preview` removes the preview value and leaves the primary one standing;
 * without it the variable is removed for both kinds. Destructive, so it takes the
 * same `--force`-or-confirm gate the resource commands' `rm` uses.
 */
export default class VariableRm extends Promptable(EnvironmentCommand) {
  static override description = "Remove one variable from the project.";
  static override group = CommandGroups.configuration;

  static override heading = "Removing a variable";
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
      description: "Remove the preview value alone, leaving the primary one standing.",
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
    const { dryRun } = this.meta;
    const name = args.name;

    assertVariableName(name);

    const { client, projectId } = await this.connect();
    const scope = variableScope(projectId, flags.preview);
    const kinds = flags.preview ? ["preview"] : ["primary", "preview"];

    // A dry run makes no request, so it answers before the guard — the order
    // the resource commands' `rm` uses, which keeps `--dry-run
    // --non-interactive` usable.
    if (dryRun) {
      const preview = dryRunResult("remove", "variable", name);
      return this.emit({
        ...preview,
        data: { ...(preview.data as object), kinds },
        pretty: `${preview.pretty} from the project${flags.preview ? " (preview)" : ""}`,
      });
    }

    const confirmed = await this.input({
      kind: "confirm",
      name: `remove ${name} from the project`,
      message: `Remove ${name} from the project?`,
      retry: this.suggest(`variable rm ${name}${flags.preview ? " --preview" : ""} --force`),
    });
    if (!confirmed) {
      return this.emit({ status: "skipped", reason: "remove-cancelled" });
    }

    await client.deleteVariable(name, scope);

    return this.emit({
      status: "ok",
      data: { ...deletedData({ name }), kinds },
      pretty: `Removed ${name} from the project${flags.preview ? " (preview)" : ""}`,
    });
  }
}
