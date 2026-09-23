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

import { ZitadelError } from "../../lib/errors";
import {
  IDPS_DIR,
  planConnection,
  readConnectionFiles,
  readSchemaFiles,
  selectSchema,
  storeClientSecret,
  type SecretOutcome,
} from "../../lib/idp";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { readDevelopmentIssuer, readZitadelConfig, readZitadelSecret } from "../../lib/project";
import { readStdin } from "../../lib/variables";

/** Fixed route every provider redirects back to, on the Project's own origin. */
const CALLBACK_PATH = "/__nextgen/idp/callback";

/** `$schema` a scaffolded connection carries, relative to `.zitadel/idps/`. */
const CONNECTION_SCHEMA_REF = "../meta/idp-connection.json";

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
    const callbackUri = `${issuer.replace(/\/$/, "")}${CALLBACK_PATH}`;

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

    consola.success(`Wrote ${plan.path}`);
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
      data: this.payload({ provider, schema: schema.name, plan, callbackUri, secret }),
      pretty: `Enabled ${entry.display_name} for ${schema.name}`,
      nextCommands: ["plan", "apply"],
    });
  }

  /** The machine-readable payload. Never the secret, only whether it is held. */
  private payload(input: {
    provider: string;
    schema: string;
    plan: { action: string; slug: string; path?: string; file?: { path: string } };
    callbackUri: string;
    secret: SecretOutcome | undefined;
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
