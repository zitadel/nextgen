import { Args, Flags } from "@oclif/core";
import { cancel, isCancel, password, text } from "@clack/prompts";

import { CommandGroups, OwnerCommand, type JsonEnvelope } from "../../lib/oclif";
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

/**
 * The `variables set` topic command — enter or replace one variable at the
 * project level.
 *
 * The value never comes from a flag. It is prompted for, or read from stdin
 * when scripting, so a credential cannot land in shell history, a process
 * listing, or CI logs. `--secret` stores it encrypted under the project's own
 * key, after which it can be replaced but never read back (ADR 062 §7).
 */
export default class VariablesSet extends OwnerCommand {
  static override description = "Set one variable on the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variables set GOOGLE_CLIENT_ID --project-level",
    "<%= config.bin %> variables set GOOGLE_CLIENT_SECRET --project-level --secret < secret.txt",
    "<%= config.bin %> variables set SESSION_TTL --project-level --as number",
  ];
  static override args = {
    name: Args.string({
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
    const { args, flags } = await this.parse(VariablesSet);
    await this.toMeta(flags);
    const { nonInteractive, dryRun, cliVersion } = this.meta;
    const name = args.name;
    const type = flags.as as VariableType;

    assertVariableName(name);
    // A credential is a string: a numeric-looking key stored as a number could
    // lose digits, and one stored as a boolean is meaningless. Refused before
    // anything is asked for, so no secret is typed only to be turned away.
    if (flags.secret && type !== "string") {
      throw new ZitadelError("E_VALIDATION", "A secret is stored as a string.", {
        hint: "Drop --as, or drop --secret for a non-credential number or boolean.",
      });
    }

    const { client, scope } = await this.connect();

    if (dryRun) {
      // The resource commands' dry-run contract, plus what this write would
      // store. Never the value: a dry run has not read it, and it may be a
      // credential.
      const preview = dryRunResult("set", "variables", name);
      return this.emit({
        ...preview,
        data: { ...(preview.data as object), secret: flags.secret, as: type },
        pretty: `${preview.pretty} on the project${flags.secret ? " (secret)" : ""}${type === "string" ? "" : ` as ${type}`}`,
      });
    }

    // A value never comes from a flag, so a scripted run has to pipe one in. A
    // terminal on stdin means nothing was piped: fail rather than block on a
    // read that would never end.
    if (nonInteractive && process.stdin.isTTY) {
      const retry = pipeHint(name, flags.secret, type, cliVersion);
      throw new ZitadelError("E_VALIDATION", `No value supplied for ${name}.`, {
        hint: `Pipe the value in: ${retry}`,
        nextCommands: [retry],
      });
    }
    // The prompt is masked when the value is to be stored as a secret, so it
    // does not stay on screen or in a scrollback buffer.
    const answer = nonInteractive
      ? await readStdin(process.stdin)
      : flags.secret
        ? await password({ message: `Value for ${name}` })
        : await text({ message: `Value for ${name}` });
    if (isCancel(answer)) {
      cancel("Set cancelled.");
      throw new ZitadelError("E_VALIDATION", "Set cancelled by user");
    }
    // An empty submission reads as `undefined` from the prompt and has to
    // become `""`, not the string "undefined". An empty string is a value the
    // scalar schema accepts; only an absent input is an error, which the stdin
    // guard above and the cancel signal cover.
    const value = parseVariableValue(String(answer ?? ""), type);

    await client.updateVariables({ [name]: { value, secret: flags.secret } }, scope);
    this.recordTelemetry({ is_secret: flags.secret });

    return this.emit({
      status: "ok",
      data: { name, secret: flags.secret, type },
      pretty: `Set ${name} on the project${flags.secret ? " (secret)" : ""}`,
    });
  }
}

/**
 * The scripted form to suggest when a run supplied no value.
 *
 * It carries the owner, the secret flag and the type the run actually used.
 * Dropping any of them would hand back a command that writes a credential as a
 * readable value, or stores a number as a string.
 */
function pipeHint(name: string, secret: boolean, type: VariableType, cliVersion: string): string {
  const args = [
    "variables",
    "set",
    name,
    "--project-level",
    ...(secret ? ["--secret"] : []),
    ...(type === "string" ? [] : ["--as", type]),
  ].join(" ");
  return `${publicCliCommand(args, cliVersion)} < value.txt`;
}
