import { Flags } from "@oclif/core";
import { cancel, confirm, isCancel } from "@clack/prompts";

import { CommandGroups, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { ZitadelError } from "../../lib/errors";
import { assertVariableName } from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";
import { VarsCommand } from "../../lib/vars-command";

/**
 * `zitadel vars rm` — remove one variable from the store. Nothing already
 * deployed changes: every deployment froze the values it resolved.
 */
export default class VarsRm extends VarsCommand {
  static override description = "Remove one variable from the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> vars rm GOOGLE_CLIENT_ID",
    "<%= config.bin %> vars rm GOOGLE_CLIENT_SECRET --preview --force",
  ];
  static override args = {
    name: nonBlankArg({ required: true, description: "Variable name to remove." }),
  };
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the variable without the confirmation prompt. Required when non-interactive.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VarsRm);
    await this.toMeta(flags);
    const { nonInteractive, dryRun, force, cliVersion } = this.meta;
    const name = args.name;
    const appliesTo = this.appliesTo(flags);

    assertVariableName(name);

    const { client, scope } = await this.connect();

    if (dryRun) {
      const preview = dryRunResult("delete", "vars", name);
      return this.emit({ ...preview, pretty: `${preview.pretty} from the project` });
    }

    if (!force) {
      if (nonInteractive) {
        const retry = publicCliCommand(
          `vars rm ${name}${appliesTo === "preview" ? " --preview" : ""} --force`,
          cliVersion,
        );
        throw new ZitadelError(
          "E_VALIDATION",
          "Removing a variable requires --force in non-interactive mode",
          { hint: `Pass --force to remove ${name} from the project.`, nextCommands: [retry] },
        );
      }
      const answer = await confirm({
        message: `Remove ${name} from the project?`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel("Remove cancelled.");
        return this.emit({ status: "skipped", reason: "rm-cancelled" });
      }
    }

    await client.deleteVariable(name, { ...scope, applies_to: appliesTo });

    return this.emit({
      status: "ok",
      data: { name, deleted: true, applies_to: appliesTo },
      pretty:
        appliesTo === "preview"
          ? `removed the preview value; previews now serve the production one.`
          : `removed ${name}. deployments already serving it are unaffected.`,
    });
  }
}
