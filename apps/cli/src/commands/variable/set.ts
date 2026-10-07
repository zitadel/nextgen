import { Flags } from "@oclif/core";
import { cancel, isCancel, password, text } from "@clack/prompts";

import { CommandGroups, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { ZitadelError } from "../../lib/errors";
import {
  assertVariableName,
  parseVariableValue,
  readStdin,
  VARIABLE_TYPES,
  type VariableType,
} from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";
import { VariableCommand } from "../../lib/variable-command";

/**
 * `zitadel variable set` — enter or replace one variable. Not live until the
 * next deploy: every deployment freezes the values it resolved.
 *
 * The value never comes from a flag. It is prompted for, or read from stdin
 * when scripting, so a credential cannot land in shell history, a process
 * listing, or CI logs. `--secret` stores it encrypted under the project's own
 * key, after which it can be replaced but never read back.
 */
export default class VariableSet extends VariableCommand {
  static override description = "Set one variable on the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable set GOOGLE_CLIENT_ID",
    "<%= config.bin %> variable set GOOGLE_CLIENT_SECRET --secret < secret.txt",
    "<%= config.bin %> variable set GOOGLE_CLIENT_SECRET --secret --preview",
    "<%= config.bin %> variable set SESSION_TTL --as number",
  ];
  static override args = {
    name: nonBlankArg({
      required: true,
      description: "Variable name (letters, digits and underscores).",
    }),
  };
  static override flags = {
    secret: Flags.boolean({
      default: false,
      description: "Store the value encrypted. It can be replaced later but never read back.",
    }),
    as: Flags.string({
      options: [...VARIABLE_TYPES],
      default: "string",
      description:
        "Store the value as this JSON type. A reference to the whole field resolves to that type, so a number stays a number.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariableSet);
    await this.toMeta(flags);
    const { nonInteractive, dryRun, cliVersion } = this.meta;
    const name = args.name;
    const type = flags.as as VariableType;
    const appliesTo = this.appliesTo(flags);

    assertVariableName(name);
    // A credential is a string: a numeric-looking key stored as a number could
    // lose digits, and one stored as a boolean is meaningless.
    if (flags.secret && type !== "string") {
      throw new ZitadelError("E_VALIDATION", "A secret is stored as a string.", {
        hint: "Drop --as, or drop --secret for a non-credential number or boolean.",
      });
    }

    const { client, scope } = await this.connect();

    if (dryRun) {
      const preview = dryRunResult("set", "variable", name);
      return this.emit({
        ...preview,
        data: { ...(preview.data as object), secret: flags.secret, as: type, applies_to: appliesTo },
        pretty: `${preview.pretty}${appliesTo === "preview" ? " for previews" : ""}${flags.secret ? " (secret)" : ""}${type === "string" ? "" : ` as ${type}`}`,
      });
    }

    // A value never comes from a flag, so a scripted run has to pipe one in.
    if (nonInteractive && process.stdin.isTTY) {
      const retry = pipeHint(name, flags.secret, type, appliesTo, cliVersion);
      throw new ZitadelError("E_VALIDATION", `No value supplied for ${name}.`, {
        hint: `Pipe the value in: ${retry}`,
        nextCommands: [retry],
      });
    }
    const answer = nonInteractive
      ? await readStdin(process.stdin)
      : flags.secret
        ? await password({ message: `Value for ${name}` })
        : await text({ message: `Value for ${name}` });
    if (isCancel(answer)) {
      cancel("Set cancelled.");
      throw new ZitadelError("E_VALIDATION", "Set cancelled by user");
    }
    const value = parseVariableValue(String(answer ?? ""), type);

    await client.updateVariables(
      { [name]: { value, secret: flags.secret } },
      { ...scope, applies_to: appliesTo },
    );
    this.recordTelemetry({ is_secret: flags.secret });

    return this.emit({
      status: "ok",
      data: { name, secret: flags.secret, type, applies_to: appliesTo },
      pretty: `stored${flags.secret ? ", encrypted" : ""}${appliesTo === "preview" ? " for previews" : ""}. not live until the next deploy.`,
    });
  }
}

/** The scripted form to suggest when a run supplied no value. */
function pipeHint(
  name: string,
  secret: boolean,
  type: VariableType,
  appliesTo: "all" | "preview",
  cliVersion: string,
): string {
  const args = [
    "variable",
    "set",
    name,
    ...(secret ? ["--secret"] : []),
    ...(appliesTo === "preview" ? ["--preview"] : []),
    ...(type === "string" ? [] : ["--as", type]),
  ].join(" ");
  return `${publicCliCommand(args, cliVersion)} < value.txt`;
}
