import { Flags } from "@oclif/core";
import { confirm, isCancel } from "@clack/prompts";
import { consola } from "consola";

import { createZitadelClient } from "@zitadel/api/client";
import type { UpdateVariablesBody } from "@zitadel/api/generated/model";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { assertVariableName, environmentParam, ownerLabel, readEnvFile } from "../../lib/variables";
import { readZitadelSecret } from "../../lib/project";

/**
 * The `variables import` topic command — enter every name in a `.env`-style
 * file at one owner, in one request.
 *
 * The file is an input, never an output: there is no matching `pull`, because
 * a secret reads back as held and not as a value, so a download would produce
 * a file that looks complete and is not.
 *
 * The preview lists names only. A value comparison is impossible for secrets
 * and would be misleading for the rest of the set, so the command states what
 * it will write rather than implying a diff.
 */
export default class VariablesImport extends BaseCommand {
  static override description = "Import a .env-style file into an environment or the project.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 8;
  static override flags = {
    environment: Flags.string({
      char: "e",
      description: "Environment to write to. Omit to write at the project level.",
    }),
    file: Flags.string({
      required: true,
      description: "Path to the .env-style file to read.",
    }),
    secret: Flags.boolean({
      default: false,
      description: "Store every imported value encrypted.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(VariablesImport);
    // Which server and which environment are independent: the CLI talks to one
    // instance, and its environments live inside that instance. `--environment`
    // names the owner there, so it is withheld from `toMeta`, which would
    // otherwise pass it to the server resolver and let a `zitadel.json`
    // `environments.<name>.server` entry redirect the request.
    await this.toMeta({ ...flags, environment: undefined });
    const { cwd, source, nonInteractive, dryRun } = this.meta;
    const environment = flags.environment;

    const owner = environmentParam(environment);
    const values = await readEnvFile(flags.file);
    const names = Object.keys(values).sort();
    for (const name of names) {
      assertVariableName(name);
    }

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project       ${secret.project_id}`);
    consola.info(`Server        ${source}`);
    consola.info(`Environment   ${ownerLabel(environment)}`);
    consola.info(`Source        ${flags.file}`);

    const where = environment ?? "the project";
    if (names.length === 0) {
      const message = `No variables found in ${flags.file}.`;
      consola.warn(message);
      return this.emit({
        status: "ok",
        data: { environment: environment ?? null, names: [], count: 0 },
        pretty: message,
      });
    }

    const preview = [
      `Will set ${names.length} variable${names.length === 1 ? "" : "s"} on ${where}:`,
      ...names.map((name) => `  ${name}${flags.secret ? "   (secret)" : ""}`),
    ].join("\n");
    if (!nonInteractive) {
      consola.log(preview);
      const ok = await confirm({ message: "Continue?" });
      if (isCancel(ok) || !ok) {
        return this.emit({
          status: "skipped",
          reason: "cancelled",
          data: { environment: environment ?? null, names, count: names.length },
        });
      }
    }
    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { environment: environment ?? null, names, count: names.length },
      });
    }

    // One patch for the whole file: the body is applied whole or not at all,
    // so a file that fails validation leaves the owner untouched rather than
    // half-written.
    const body: UpdateVariablesBody = Object.fromEntries(
      names.map((name) => [name, { value: values[name] as string, secret: flags.secret }]),
    );
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    await client.updateVariables(body, { project_id: secret.project_id, ...owner });
    this.recordTelemetry({
      count: names.length,
      secret: flags.secret,
      scoped: environment !== undefined,
    });

    return this.emit({
      status: "ok",
      data: { environment: environment ?? null, names, count: names.length },
      pretty: `Set ${names.length} variable${names.length === 1 ? "" : "s"} on ${where}`,
    });
  }
}
