import { Args, Flags } from "@oclif/core";
import { cancel, isCancel, password, text } from "@clack/prompts";

import { CommandGroups, EnvironmentCommand, type JsonEnvelope, nonBlankArg } from "../../lib/oclif";
import { dryRunResult } from "../../lib/oclif/crud/shared";
import { ZitadelError } from "../../lib/errors";
import {
  assertVariableName,
  parseVariableValue,
  readStdin,
  VARIABLE_TYPES,
  type VariableType,
  variableScope,
} from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";

/**
 * `zitadel variable set NAME [VALUE]` — enter or replace one variable on the
 * project.
 *
 * A plain value may be given on the command line; a secret never can. A secret
 * is prompted for, or read from stdin when scripting, so a credential cannot
 * land in shell history, a process listing, or CI logs. `--secret` stores it
 * encrypted under the project's own key, after which it can be replaced but
 * never read back (ADR 062 §7). `--preview` writes the override a preview
 * deploy prefers instead of the value every deploy freezes.
 */
export default class VariableSet extends EnvironmentCommand {
  static override description = "Set one variable on the project.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> variable set GOOGLE_CLIENT_ID 1234.apps.googleusercontent.com",
    "<%= config.bin %> variable set GOOGLE_CLIENT_SECRET --secret < secret.txt",
    "<%= config.bin %> variable set SESSION_TTL 3600 --as number",
    "<%= config.bin %> variable set API_URL https://preview.acme.com --preview",
  ];
  static override args = {
    name: nonBlankArg({
      required: true,
      description: "Variable name (letters, digits and underscores).",
    }),
    // A plain value may be given here; an empty string is a value the scalar
    // schema accepts, so this is not `nonBlankArg`. A secret refuses it below.
    // `ignoreStdin` keeps oclif from folding piped input into this arg — a
    // secret and a scripted plain value both arrive on stdin, which this command
    // reads itself through `readStdin`.
    value: Args.string({
      required: false,
      ignoreStdin: true,
      description: "The value, for a plain (non-secret) variable.",
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
    preview: Flags.boolean({
      default: false,
      description: "Write the preview override instead of the value every deploy freezes.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariableSet);
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
    // A secret never comes from the command line: it would land in shell history
    // and a process listing. It is prompted for or piped instead.
    if (flags.secret && args.value !== undefined) {
      throw new ZitadelError("E_VALIDATION", "A secret value is not given on the command line.", {
        hint: "Drop the value and pipe it in, or let the prompt ask for it.",
      });
    }

    const { client, projectId } = await this.connect();
    const scope = variableScope(projectId, flags.preview);

    if (dryRun) {
      // The resource commands' dry-run contract, plus what this write would
      // store. Never the value: it may be a credential.
      const preview = dryRunResult("set", "variable", name);
      return this.emit({
        ...preview,
        data: {
          ...(preview.data as object),
          secret: flags.secret,
          as: type,
          applies_to: flags.preview ? "preview" : "all",
        },
        pretty: `${preview.pretty} on the project${flags.secret ? " (secret)" : ""}${type === "string" ? "" : ` as ${type}`}${flags.preview ? " (preview)" : ""}`,
      });
    }

    // A plain value given on the command line is used as it is. Otherwise the
    // value is prompted for, or read from stdin when scripting.
    let raw: string;
    if (args.value !== undefined && !flags.secret) {
      raw = args.value;
    } else {
      // A terminal on stdin means nothing was piped: fail rather than block on a
      // read that would never end.
      if (nonInteractive && process.stdin.isTTY) {
        const retry = pipeHint(name, flags.secret, type, flags.preview, cliVersion);
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
      // scalar schema accepts.
      raw = String(answer ?? "");
    }
    const value = parseVariableValue(raw, type);

    await client.updateVariables({ [name]: { value, secret: flags.secret } }, scope);
    this.recordTelemetry({ is_secret: flags.secret });

    return this.emit({
      status: "ok",
      data: { name, secret: flags.secret, type, applies_to: flags.preview ? "preview" : "all" },
      pretty: `Set ${name} on the project${flags.secret ? " (secret)" : ""}${flags.preview ? " (preview)" : ""}`,
    });
  }
}

/**
 * The scripted form to suggest when a run supplied no value.
 *
 * It carries the secret flag, the type and the preview flag the run actually
 * used. Dropping any of them would hand back a command that writes a credential
 * as a readable value, stores a number as a string, or writes the wrong value.
 */
function pipeHint(
  name: string,
  secret: boolean,
  type: VariableType,
  preview: boolean,
  cliVersion: string,
): string {
  const args = [
    "variable",
    "set",
    name,
    ...(secret ? ["--secret"] : []),
    ...(type === "string" ? [] : ["--as", type]),
    ...(preview ? ["--preview"] : []),
  ].join(" ");
  return `${publicCliCommand(args, cliVersion)} < value.txt`;
}
