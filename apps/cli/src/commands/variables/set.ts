import { Args, Flags } from "@oclif/core";
import { isCancel, password, text } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { assertVariableName, environmentParam, ownerLabel, readStdin } from "../../lib/variables";
import { publicCliCommand } from "../../lib/public-cli";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables set` topic command — enter or replace one variable at one owner.
 *
 * The value never comes from a flag. It is prompted for, or read from stdin
 * when scripting, so a credential cannot land in shell history, a process
 * listing, or CI logs. `--secret` stores it encrypted under the project's own
 * key, after which it can be replaced but never read back (ADR 062 §7).
 */
export default class VariablesSet extends BaseCommand {
  static override description = "Set one variable on an environment or the project.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 6;
  static override args = {
    name: Args.string({
      required: true,
      description: "Variable name (letters, digits and underscores).",
    }),
  };
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Environment to write to. Omit to write at the project level.",
    }),
    secret: Flags.boolean({
      default: false,
      description: "Store the value encrypted. It can be replaced later but never read back.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { args, flags } = await this.parse(VariablesSet);
    await this.toMeta(flags);
    const { cwd, source, nonInteractive, cliVersion } = this.meta;
    const environment = flags.environment;
    const name = args.name;

    assertVariableName(name);
    // Validate the owner before prompting: failing after the user has typed a
    // secret would make them type it again.
    const owner = environmentParam(environment);

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project       ${secret.project_id}`);
    consola.info(`Environment   ${ownerLabel(environment)}`);

    // A value never comes from a flag, so a scripted run has to pipe it in. A
    // terminal on stdin means nothing was piped: fail rather than block on a
    // read that would never end.
    if (nonInteractive && process.stdin.isTTY) {
      throw new ZitadelError("E_VALIDATION", `No value supplied for ${name}.`, {
        hint: `Pipe the value in: ${pipeHint(name, cliVersion)}`,
      });
    }
    const value = nonInteractive
      ? await readStdin(process.stdin)
      : await promptValue(name, flags.secret);
    if (value === "") {
      throw new ZitadelError("E_VALIDATION", `No value supplied for ${name}.`, {
        hint: nonInteractive
          ? `Pipe the value in: ${pipeHint(name, cliVersion)}`
          : "Enter a value at the prompt.",
      });
    }

    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    await client.updateVariables(
      { [name]: { value, secret: flags.secret } },
      { project_id: secret.project_id, ...owner },
    );
    this.recordTelemetry({ secret: flags.secret, scoped: environment !== undefined });

    const where = environment ?? "the project";
    return this.emit({
      status: "ok",
      data: { environment: environment ?? null, name, secret: flags.secret },
      pretty: `Set ${name} on ${where}${flags.secret ? " (secret)" : ""}`,
    });
  }
}

/** The scripted form to suggest when a run supplied no value. */
function pipeHint(name: string, cliVersion: string): string {
  return `${publicCliCommand(`variables set ${name}`, cliVersion)} < value.txt`;
}

/**
 * Ask for the value, masked when it is to be stored as a secret so it does not
 * stay on screen or in a scrollback buffer.
 */
async function promptValue(name: string, secret: boolean): Promise<string> {
  const answer = secret
    ? await password({ message: `Value for ${name}` })
    : await text({ message: `Value for ${name}` });
  if (isCancel(answer)) {
    throw new ZitadelError("E_VALIDATION", `No value supplied for ${name}.`, {
      hint: "Enter a value at the prompt.",
    });
  }
  return String(answer ?? "");
}
