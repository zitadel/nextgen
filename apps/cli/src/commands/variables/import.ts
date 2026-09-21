import { Flags } from "@oclif/core";
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
 * `--dry-run` lists the names it would write. It never lists values: a
 * comparison is impossible for secrets, so claiming a diff would be a lie.
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
    // Which server and which environment are independent: the CLI talks to one
    // instance, and its environments live inside that instance. `--environment`
    // names the owner there, so it is withheld from `toMeta`, which would
    // otherwise pass it to the server resolver and let a `zitadel.json`
    // `environments.<name>.server` entry redirect the request.
    const { flags } = await this.parse(VariablesImport);
    await this.toMeta({ ...flags, environment: undefined });
    const { cwd, source, dryRun } = this.meta;
    const environment = flags.environment;

    const owner = environmentParam(environment);
    const values = await readEnvFile(flags.file);
    const names = Object.keys(values).sort();
    for (const name of names) {
      assertVariableName(name);
    }

    const secret = await readZitadelSecret(cwd);
    consola.info(`Project   ${secret.project_id}`);
    consola.info(`Server    ${source}`);

    const where = ownerLabel(environment);
    if (names.length === 0) {
      const message = `No variables found in ${flags.file}.`;
      consola.warn(message);
      return this.emit({
        status: "ok",
        data: { environment: environment ?? null, names: [], count: 0 },
        pretty: message,
      });
    }

    if (dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: `Set ${names.length} variable${names.length === 1 ? "" : "s"} on ${where}.`,
          environment: environment ?? null,
          names,
          count: names.length,
          secret: flags.secret,
        },
        pretty: renderPlan(names, where, flags.secret),
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
    consola.start(`Setting ${names.length} variable${names.length === 1 ? "" : "s"} on ${where}`);
    await client.updateVariables(body, { project_id: secret.project_id, ...owner });
    consola.success("Import complete");
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

/** Names only — a value comparison is impossible for a secret. */
function renderPlan(names: ReadonlyArray<string>, where: string, secret: boolean): string {
  return [
    `Will set ${names.length} variable${names.length === 1 ? "" : "s"} on ${where}:`,
    ...names.map((name) => `  ${name}${secret ? "  (secret)" : ""}`),
  ].join("\n");
}
