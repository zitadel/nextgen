import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Flags } from "@oclif/core";
import { cancel, isCancel, password, select, text } from "@clack/prompts";
import { consola } from "consola";

import {
  clientSecretVariableName,
  idpCatalogEntry,
  IDP_PROVIDERS,
  scaffoldConnection,
} from "@zitadel/config/idp-catalog";
import { applySsoToFlow, applySsoToSchema, type SsoSkipped } from "@zitadel/config/sso";

import { ZitadelError } from "../../lib/errors";
import {
  callbackUriFor,
  CONNECTION_SCHEMA_REF,
  enabledMethods,
  IDPS_DIR,
  planConnection,
  readFlowFiles,
  readConnectionFiles,
  readSchemaFiles,
  selectSchema,
  storeClientSecret,
  type SchemaFile,
  type SecretOutcome,
} from "../../lib/idp";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { readDevelopmentIssuer, readZitadelConfig, readZitadelSecret } from "../../lib/project";
import { readState } from "../../lib/sync/state";
import { readStdin } from "../../lib/variables";

/**
 * The `sso enable` command — add a provider to a Project's sign-in methods.
 *
 * One direct journey: the developer is told what to register with the
 * provider, gives back the credentials, and the Project's configuration is
 * written. It works on the local Project `zitadel setup` created and does not
 * require claiming, because this is the local development path.
 *
 * The client secret never comes from a flag, following `variables set`: it is
 * prompted for, or read from stdin when scripting, so it cannot land in shell
 * history, a process listing, or CI logs.
 */
export default class SsoEnable extends BaseCommand {
  static override description = "Enable an identity provider for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> sso enable --provider google",
    "<%= config.bin %> sso enable --provider google --schema customers",
    "<%= config.bin %> sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt",
  ];
  static override flags = {
    provider: Flags.string({
      required: true,
      options: [...IDP_PROVIDERS],
      description: "Identity provider to enable.",
    }),
    schema: Flags.string({
      description: "User schema to change. Required when the Project has more than one.",
    }),
    "client-id": Flags.string({
      description: "Client id of the application registered with the provider.",
    }),
    "no-open": Flags.boolean({
      default: false,
      description: "Do not offer to open the provider's console in a browser.",
    }),
    "secret-stdin": Flags.boolean({
      default: false,
      description: "Read the client secret from standard input. Never pass a secret as a flag.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(SsoEnable);
    await this.toMeta(flags);
    const { cwd, nonInteractive, dryRun } = this.meta;

    const provider = flags.provider as string;
    const entry = idpCatalogEntry(provider);

    // The Project is read before anything is asked for: being turned away
    // after typing a secret would mean typing it again.
    const config = await readZitadelConfig(cwd);
    const secretFile = await readZitadelSecret(cwd);
    const issuer = readDevelopmentIssuer(config);
    if (issuer === undefined) {
      throw new ZitadelError("E_VALIDATION", "This Project has no development issuer", {
        hint: "Run `zitadel setup` first, or add environments.development.issuer to zitadel.json.",
      });
    }
    const callbackUri = callbackUriFor(issuer);

    const schema = selectSchema(await readSchemaFiles(cwd), flags.schema);
    const connections = await readConnectionFiles(cwd);
    const plan = planConnection({ provider, files: connections, clientId: flags["client-id"] });

    consola.info(`Project   ${secretFile.project_id}`);
    consola.info(`Schema    ${schema.path}${schema.methods.length > 0 ? ` (${schema.methods.join(", ")})` : ""}`);

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: this.payload({ provider, schema: schema.name, plan, callbackUri, secret: undefined }),
        pretty: `Would ${plan.action} ${plan.action === "reuse" ? plan.file.path : plan.path}`,
      });
    }

    // Reusing an existing connection asks for nothing: its credentials are
    // already configured, and a second prompt would invite replacing them.
    if (plan.action === "reuse") {
      consola.success(`Reusing ${plan.file.path}`);
      return this.emit({
        status: "ok",
        data: this.payload({ provider, schema: schema.name, plan, callbackUri, secret: undefined }),
        pretty: `Reused the ${entry.display_name} connection in ${plan.file.path}`,
      });
    }

    consola.info(`${entry.display_name} needs an OAuth application.`);
    consola.info(`Callback URI   ${callbackUri}`);
    consola.info(`Create it at   ${entry.console_url}`);

    const clientId = flags["client-id"] ?? (await this.askClientId(entry.display_name, nonInteractive));
    const variable = clientSecretVariableName(plan.slug);
    const secretValue = await this.askClientSecret(variable, nonInteractive, flags["secret-stdin"]);

    const connection = scaffoldConnection({
      provider,
      clientId,
      slug: plan.slug,
      schemaProperties: schema.properties,
      schemaRef: CONNECTION_SCHEMA_REF,
    });
    const target = join(cwd, plan.path);
    await mkdir(dirname(target), { recursive: true });
    // `wx` rather than a plain write: planConnection decided this file does
    // not exist, and anything that appeared since is not ours to overwrite.
    await writeFile(target, `${JSON.stringify(connection, null, 2)}\n`, { flag: "wx" });
    const secret = await storeClientSecret({ cwd, name: variable, value: secretValue });
    const edits = await this.enableInConfiguration(cwd, schema, plan.slug);

    consola.success(`Wrote ${plan.path}`);
    for (const file of edits.written) {
      consola.success(`Updated ${file}`);
    }
    for (const skipped of edits.skipped) {
      consola.warn(`Left ${skipped.region} alone: it has been edited by hand. Update it yourself.`);
    }
    if (secret.stored) {
      consola.success(`Stored ${variable} in .env.local`);
    } else {
      consola.warn(
        secret.reason === "deferred"
          ? `${variable} has no value yet. Set it in .env.local before signing in.`
          : `${variable} was not written: .env.local is not ignored by git. Set it yourself, or ignore that file first.`,
      );
    }

    return this.emit({
      status: "ok",
      data: this.payload({
        provider,
        schema: schema.name,
        plan,
        callbackUri,
        secret,
        changed: edits.written,
        skipped: edits.skipped,
      }),
      pretty: `Enabled ${entry.display_name} for ${schema.name}`,
      nextCommands: ["plan", "apply"],
    });
  }


  /**
   * Enable the provider in the schema and every login flow that runs against
   * it, writing only what changed. A flow belonging to another schema is left
   * alone: enabling Google for customers must not touch the employee journey.
   */
  private async enableInConfiguration(
    cwd: string,
    schema: SchemaFile,
    slug: string,
  ): Promise<{ written: string[]; skipped: SsoSkipped[] }> {
    const written: string[] = [];
    const skipped: SsoSkipped[] = [];

    const schemaResult = applySsoToSchema(schema.body, slug);
    if (schemaResult.changed) {
      await writeFile(join(cwd, schema.path), `${JSON.stringify(schemaResult.document, null, 2)}\n`);
      written.push(schema.path);
    }

    const methods = enabledMethods(schema);
    const publishedSchemaId = await publishedIdOf(cwd, schema.path);
    for (const flow of await readFlowFiles(cwd)) {
      if (!flowUsesSchema(flow.body, schema, publishedSchemaId)) {
        continue;
      }
      const result = applySsoToFlow(flow.body, slug, methods);
      skipped.push(...result.skipped.map((entry) => ({ ...entry, region: `${flow.path} ${entry.region}` })));
      if (result.changed) {
        await writeFile(join(cwd, flow.path), `${JSON.stringify(result.document, null, 2)}\n`);
        written.push(flow.path);
      }
    }
    return { written, skipped };
  }

  /** The machine-readable payload. Never the secret, only whether it is held. */
  private payload(input: {
    provider: string;
    schema: string;
    plan: { action: string; slug: string; path?: string; file?: { path: string } };
    callbackUri: string;
    secret: SecretOutcome | undefined;
    changed?: string[];
    skipped?: SsoSkipped[];
  }): Record<string, unknown> {
    return {
      provider: input.provider,
      schema: input.schema,
      connection: {
        action: input.plan.action,
        slug: input.plan.slug,
        file: input.plan.file?.path ?? input.plan.path ?? `${IDPS_DIR}/${input.plan.slug}.json`,
      },
      callback_uri: input.callbackUri,
      changed: input.changed ?? [],
      untouched: (input.skipped ?? []).map((s) => s.region),
      secret:
        input.secret === undefined
          ? null
          : { variable: input.secret.name, stored: input.secret.stored },
    };
  }

  private async askClientId(displayName: string, nonInteractive: boolean): Promise<string> {
    if (nonInteractive) {
      throw new ZitadelError("E_VALIDATION", `No client id supplied for ${displayName}.`, {
        hint: "Pass --client-id, or run without --non-interactive to be asked for it.",
      });
    }
    const answer = await text({
      message: "Client ID",
      // Vendors format these differently, so only emptiness can be checked.
      validate: (value) => (value.trim() === "" ? "Enter the client id." : undefined),
    });
    if (isCancel(answer)) {
      cancel("Nothing was changed.");
      throw new ZitadelError("E_CANCELLED", "Cancelled by user");
    }
    return String(answer).trim();
  }

  /**
   * Ask for the secret, or read it from stdin when explicitly asked to.
   *
   * Empty is a deliberate answer: the developer may prefer to paste it into
   * `.env.local` themselves, and the connection file is written either way.
   * A scripted run therefore has to opt in with `--secret-stdin`, because
   * reading stdin on the chance something was piped would hang every run that
   * piped nothing — stdin stays open with no data and no end.
   */
  private async askClientSecret(
    variable: string,
    nonInteractive: boolean,
    fromStdin: boolean,
  ): Promise<string | undefined> {
    if (fromStdin) {
      const piped = (await readStdin(process.stdin)).trim();
      return piped === "" ? undefined : piped;
    }
    if (nonInteractive) {
      return undefined;
    }
    const answer = await password({ message: `Client secret (stored in .env.local as ${variable}, Enter to skip)` });
    if (isCancel(answer)) {
      cancel("Nothing was changed.");
      throw new ZitadelError("E_CANCELLED", "Cancelled by user");
    }
    const value = String(answer ?? "").trim();
    return value === "" ? undefined : value;
  }
}

/**
 * Whether a flow runs against this schema. Flows name it by the URL the
 * schema publishes, so the schema's own `$id` is the reliable link; a Project
 * with one schema and one flow matches on that alone.
 */
function flowUsesSchema(
  flow: Record<string, unknown>,
  schema: SchemaFile,
  publishedSchemaId: string | undefined,
): boolean {
  const used = flow.user_schema;
  if (typeof used !== "string") {
    return false;
  }
  // Once a Project has been applied, the flow names the schema by the id the
  // platform assigned, which `.zitadel/state.json` records against the schema
  // file. Before that it still carries the scaffolded URL.
  if (publishedSchemaId !== undefined && used === publishedSchemaId) {
    return true;
  }
  const id = schema.body.$id;
  if (typeof id === "string" && id === used) {
    return true;
  }
  return used.endsWith(`/${schema.name}.json`);
}

/**
 * The platform id a local file was last synced as, from `.zitadel/state.json`.
 * Absent before the first `apply`, and absent entirely on a Project that has
 * never synced — both mean "fall back to matching on the scaffolded URL".
 */
async function publishedIdOf(cwd: string, path: string): Promise<string | undefined> {
  try {
    const state = await readState(cwd);
    return state.resources?.[path]?.id;
  } catch {
    return undefined;
  }
}
