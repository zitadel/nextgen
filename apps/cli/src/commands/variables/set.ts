import { Args, Flags } from "@oclif/core";
import { cancel, isCancel, password, text } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { ownerLabel } from "../../lib/environment";
import { CommandGroups, EnvironmentCommand, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import {
  assertVariableName,
  parseVariableValue,
  readStdin,
  VARIABLE_TYPES,
  type VariableType,
} from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables set` topic command — enter or replace one variable at one
 * owner.
 *
 * The value never comes from a flag. It is prompted for, or read from stdin
 * when scripting, so a credential cannot land in shell history, a process
 * listing, or CI logs. `--secret` stores it encrypted under the project's own
 * key, after which it can be replaced but never read back (ADR 062 §7).
 */
export default class VariablesSet extends EnvironmentCommand {
  static override description = "Set one variable on an environment or the project.";
  static override group = CommandGroups.configuration;
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
    type: Flags.string({
      options: [...VARIABLE_TYPES],
      default: "string",
      description:
        "Store the value as this JSON type. A reference to the whole field resolves to that type, so a number stays a number.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariablesSet);
    await this.toMeta(flags);
    const { cwd, source, nonInteractive, dryRun, cliVersion } = this.meta;
    const name = args.name;
    const type = flags.type as VariableType;

    assertVariableName(name);
    // A credential is a string: a numeric-looking key stored as a number could
    // lose digits, and one stored as a boolean is meaningless. Refused before
    // anything is asked for, so no secret is typed only to be turned away.
    if (flags.secret && type !== "string") {
      throw new ZitadelError("E_VALIDATION", "A secret is stored as a string.", {
        hint: "Drop --type, or drop --secret for a non-credential number or boolean.",
      });
    }

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
    // Resolve the owner before asking for the value: being refused after typing
    // a secret would mean typing it again.
    const environment = await this.resolveOwner(client, secret.project_id);
    const where = ownerLabel(environment);

    if (dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: `Set ${name} on ${where}.`,
          environment: environment ?? null,
          name,
          secret: flags.secret,
        },
      });
    }

    // A value never comes from a flag, so a scripted run has to pipe one in. A
    // terminal on stdin means nothing was piped: fail rather than block on a
    // read that would never end.
    if (nonInteractive && process.stdin.isTTY) {
      const retry = pipeHint(name, environment, flags.secret, type, cliVersion);
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

    await client.updateVariables(
      { [name]: { value, secret: flags.secret } },
      {
        project_id: secret.project_id,
        ...(environment ? { environment_name: environment } : {}),
      },
    );
    this.recordTelemetry({
      is_secret: flags.secret,
      is_environment_scoped: environment !== undefined,
    });

    return this.emit({
      status: "ok",
      data: { environment: environment ?? null, name, secret: flags.secret, type },
      pretty: `Set ${name} on ${where}${flags.secret ? " (secret)" : ""}`,
    });
  }
}

/**
 * The scripted form to suggest when a run supplied no value.
 *
 * It carries the owner, the secret flag and the type the run actually used.
 * Dropping any of them would hand back a command that writes somewhere else,
 * writes a credential as a readable value, or stores a number as a string.
 */
function pipeHint(
  name: string,
  environment: string | undefined,
  secret: boolean,
  type: VariableType,
  cliVersion: string,
): string {
  const args = [
    "variables",
    "set",
    name,
    ...(environment ? ["--environment", environment] : ["--project-level"]),
    ...(secret ? ["--secret"] : []),
    ...(type === "string" ? [] : ["--type", type]),
  ].join(" ");
  return `${publicCliCommand(args, cliVersion)} < value.txt`;
}
