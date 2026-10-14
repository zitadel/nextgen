import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Flags } from "@oclif/core";
import { consola } from "consola";

import {
  type ClientIdVariable,
  type ConnectionSlug,
  credentialVariables,
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  parseClientId,
  parseClientSecret,
  type ProviderName,
  providerOf,
  selectionName,
  validated,
} from "@zitadel/config/idp";

import type { ZitadelClient } from "../../lib/api-client";
import { isDevelopmentBuild } from "../../lib/build-channel";
import { isErrno, ZitadelError } from "../../lib/errors";
import { stableStringify } from "../../lib/json";
import {
  applySsoToFlow,
  applySsoToSchema,
  askConnectionEndpoints,
  callbackUriFor,
  CONNECTION_SCHEMA_REF,
  enabledMethods,
  type ConnectionPlan,
  type FlowFile,
  credentialVariablesOf,
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  loopbackIssuerWarning,
  planConnection,
  publishClientId,
  type PublishState,
  readConnectionFiles,
  readFlowFiles,
  readSchemaFiles,
  selectionFromFlags,
  reportClientIdOutcome,
  type StoredVariables,
  republishCommands,
  ssoEditRefusal,
  type SsoEditTarget,
  type SsoSkipped,
  reportSecretOutcome,
  selectSchema,
  storeClientSecret,
  type SchemaFile,
  type SecretOutcome,
  type SecretPublisher,
} from "../../lib/idp";
import {
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { readState } from "../../lib/sync/state";
import { reportWarning } from "../../lib/warnings";
import { inShell, type SuggestedCommand } from "../../lib/suggestion";
import { nextCommandsData } from "../../lib/oclif/envelope";

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
export default class SsoEnable extends EnvironmentCommand {
  static override description = "Enable an identity provider for a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> sso enable --provider google",
    "<%= config.bin %> sso enable --provider google --schema customers",
    "<%= config.bin %> sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt",
    `<%= config.bin %> sso enable ${customExample(ENABLE_FLAG_NAMES)}`,
    `<%= config.bin %> sso enable ${customExample(ENABLE_FLAG_NAMES, true)} --client-id abc123 --non-interactive < secret.txt`,
  ];
  static override flags = {
    // Not `required`: oclif's own "Missing required flag provider" is the one
    // refusal in this command that would carry no hint, and every other error
    // here names the next move. The check below does that instead.
    [ENABLE_FLAG_KEYS.provider]: Flags.string({
      options: [...IDP_PROVIDERS, CUSTOM_PROVIDER],
      description: `Identity provider to enable, or "${CUSTOM_PROVIDER}" for any other OpenID Connect provider.`,
    }),
    [ENABLE_FLAG_KEYS.slug]: nonBlankString({
      description: "Name of the custom connection. Schemas and flows refer to it by this.",
    }),
    [ENABLE_FLAG_KEYS.displayName]: nonBlankString({
      description: "Name shown on the custom connection's sign-in button.",
    }),
    [ENABLE_FLAG_KEYS.issuer]: nonBlankString({
      description: "Issuer URL of the custom provider. Its endpoints are found by OIDC discovery.",
    }),
    [ENABLE_FLAG_KEYS.scopes]: nonBlankString({
      description:
        "Scopes the custom connection requests, separated by spaces or commas. Must include openid. Default: openid profile email.",
    }),
    schema: nonBlankString({
      description: "User schema to change. Required when the Project has more than one.",
    }),
    "client-id": nonBlankString({
      description: "Client id of the application registered with the provider.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(SsoEnable);
    await this.toMeta(flags);
    const { cwd, nonInteractive, dryRun } = this.meta;

    const provider = flags[ENABLE_FLAG_KEYS.provider];
    if (provider === undefined) {
      // Named rather than prompted for: the catalog holds one provider today,
      // and a question offering a single answer is a keystroke, not a choice
      // (the same reasoning `OwnerCommand` gives for requiring an owner).
      throw new ZitadelError("E_VALIDATION", "Name the provider to enable", {
        hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}.`,
      });
    }
    // Checked before the Project is read, like the provider itself: a name or
    // issuer the server would refuse on apply is refused here, where it was typed.
    const selection = selectionFromFlags(
      provider,
      customFlagValues(flags, ENABLE_FLAG_KEYS),
      ENABLE_FLAG_NAMES,
      customExample(ENABLE_FLAG_NAMES),
    );
    const entry = providerOf(selection);
    // What an agent can run once the missing credential is to hand. Only for a
    // catalog provider: a custom connection needs its settings repeated too.
    const retryFor = (clientId: string, pipe = ""): SuggestedCommand | undefined =>
      selection.kind === "catalog"
        ? inShell(this.suggest(`sso enable --provider ${provider} --client-id ${clientId}`), {
            before: pipe,
          })
        : undefined;
    const loopback = loopbackIssuerWarning(selection);
    if (loopback !== undefined) {
      reportWarning(loopback);
    }

    // The Project is read before anything is asked for: being turned away
    // after typing a secret would mean typing it again.
    const { client, projectId } = await this.connect({ quiet: true });
    const issuer = this.environment.values.ZITADEL_ISSUER?.value;
    if (issuer === undefined) {
      throw new ZitadelError("E_VALIDATION", "This Project has no development issuer", {
        hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
      });
    }
    const callbackUri = callbackUriFor(issuer);

    const schema = selectSchema(await readSchemaFiles(cwd), flags.schema);
    const connections = await readConnectionFiles(cwd);
    // `nonBlankString` has already refused a blank one.
    const clientIdFlag =
      flags["client-id"] === undefined ? undefined : validated(parseClientId(flags["client-id"]));
    const plan = planConnection({
      selection,
      files: connections,
      clientId: clientIdFlag,
      scopesGiven: flags[ENABLE_FLAG_KEYS.scopes] !== undefined,
      slugFlag: ENABLE_FLAG_NAMES.slug,
    });

    const reusing = plan.action === "reuse";
    if (plan.action === "create" && plan.alsoUsesIssuer !== undefined) {
      reportWarning(
        `${plan.alsoUsesIssuer.join(", ")} already connects to ${selectionName(selection)}'s issuer under another slug, so this adds a second ${selectionName(selection)} connection and button.`,
      );
    }
    if (plan.action === "reuse" && plan.notApplied !== undefined) {
      reportWarning(
        `${plan.file.path} already exists, so the ${plan.notApplied.join(" and ")} you gave ${plan.notApplied.length === 1 ? "was" : "were"} not applied. Edit the file to change ${plan.notApplied.length === 1 ? "it" : "them"}.`,
      );
    }
    // A reused connection may name its own variables — it is an editable file
    // — so the credentials go where it actually looks rather than where this
    // command would have put them. A name is `undefined` when the file holds
    // that credential as a literal: there is no variable to publish to, and
    // publishing to a derived name would report success for a value the
    // connection never reads.
    // What a newly written connection will reference: this command writes both
    // as `${{ NAME }}`, so on the create path the names are certain.
    const scaffolded = credentialVariables(plan.slug);
    const names: StoredVariables = reusing
      ? credentialVariablesOf(plan.file, plan.slug)
      : scaffolded;
    const variable = names.clientSecret;
    const idVariable = names.clientId;

    // Read-only, and before the dry-run return: a Project whose flows all name
    // another schema must fail identically either way, or the preview says
    // "would create" for a run that cannot succeed.
    const flows = await this.targetFlows(cwd, schema);

    consola.info(`Project   ${projectId}`);
    consola.info(
      `Schema    ${schema.path}${schema.methods.length > 0 ? ` (${schema.methods.join(", ")})` : ""}`,
    );

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: this.payload({
          projectId: projectId,
          provider: selectionName(selection),
          schema: schema.name,
          plan,
          callbackUri,
          secret: undefined,
          clientId: undefined,
          idVariable,
        }),
        pretty: `Would ${plan.action} ${plan.action === "reuse" ? plan.file.path : plan.path}`,
      });
    }
    // An existing connection is reused rather than rewritten, but the schema
    // and flow edits still run: those are the point of the command, they are
    // per-schema, and they are idempotent. Enabling the provider for a second
    // user type, and finishing a run interrupted after the connection file was
    // written, both arrive here.
    let secret: SecretOutcome | undefined;
    let clientIdState: PublishState | undefined;

    if (reusing) {
      consola.success(`Reusing ${plan.file.path}`);
      // The connection references its credentials rather than holding them, so
      // reuse is not evidence they were ever published: a run interrupted
      // between writing the file and publishing leaves the document pointing
      // at variables that do not exist. A supplied credential is published
      // again, which costs one call and makes the command idempotent --
      // rerunning with a changed client id now takes effect instead of being
      // silently ignored. Nothing is prompted for: an unattended rerun should
      // not start asking for credentials the project already has.
      const publish = this.publisher(client, projectId);
      if (clientIdFlag !== undefined) {
        if (idVariable === undefined) {
          reportWarning(
            `${plan.file.path} holds its client id directly, so nothing was published. ` +
              "Edit the file to change it.",
          );
        } else {
          clientIdState = await publishClientId({
            name: idVariable,
            value: clientIdFlag,
            publish,
          });
        }
      }
      // Reuse never demands a secret: the project may already hold it, and
      // refusing an unattended rerun for a credential that has not changed
      // would be noise. It is only read so that a rerun can replace it.
      const piped = await this.input({
        kind: "secret",
        name: "client secret",
        message: "Client secret",
        parse: parseClientSecret,
        stdin: true,
        optional: true,
      });
      if (piped !== undefined) {
        if (variable === undefined) {
          reportWarning(
            `${plan.file.path} holds its client secret directly, so nothing was published. ` +
              "Replace it with a ${{ NAME }} reference so the secret is not committed.",
          );
        } else {
          secret = await storeClientSecret({ name: variable, value: piped, publish });
        }
      }
    } else {
      consola.info(`${entry.displayName} needs an OAuth application.`);
      consola.info(`Callback URI   ${callbackUri}`);
      // A custom provider has no console to send the developer to: it is
      // theirs, and the issuer they gave is the only address known.
      consola.info(
        entry.consoleUrl === undefined
          ? `Register it as a client at ${entry.issuer}, with the callback URI above.`
          : `Create it at   ${entry.consoleUrl}`,
      );

      // Before the credentials: on a development run (ZITADEL_CLI_DEV) the
      // provider may be a local stand-in, and the client is registered with
      // whatever answers. Not asked of a custom connection, whose issuer the
      // developer has already given.
      const endpoints =
        selection.kind === "catalog"
          ? await askConnectionEndpoints({
              provider: selection.id,
              developmentBuild: isDevelopmentBuild() && !nonInteractive,
              ask: this.input,
            })
          : undefined;
      const clientId = await this.input({
        kind: "text",
        name: `client id for ${entry.displayName}`,
        message: "Client ID",
        flag: "--client-id",
        parse: parseClientId,
        given: flags["client-id"],
        retry: retryFor("<client-id>"),
      });
      // Required, like the client id. The connection document references the
      // secret as `${{ NAME }}` and the engine resolves that from the project's
      // variables, so enabling a provider without one writes a sign-in button
      // that fails at the token endpoint with `invalid_client` -- a failure
      // that surfaces in a browser, not here. Refusing now is the cheaper answer.
      const secretValue = await this.input({
        kind: "secret",
        name: `client secret for ${scaffolded.clientSecret}`,
        message: `Client secret (published to the project as ${scaffolded.clientSecret})`,
        parse: parseClientSecret,
        stdin: true,
        retry: retryFor(clientId, `printf '%s' "$CLIENT_SECRET" | `),
      });

      const publish = this.publisher(client, projectId);
      const connection = entry.connection({
        slug: plan.slug,
        schemaProperties: schema.properties,
        schemaRef: CONNECTION_SCHEMA_REF,
        endpoints,
      });
      // A connection is scaffolded with the properties the provider maps by
      // default, narrowed to what the schema defines. A schema that defines none
      // of them leaves it with no mapping, and `plan` refuses a connection that
      // fills nothing, so say so now and not on the next command.
      if (!("claim_mapping" in connection)) {
        reportWarning(
          `${schema.path} defines none of the properties ${entry.displayName} maps by default, so ${plan.path} has no claim_mapping ` +
            `and no sign-in can fill a user. Add the properties your provider returns to claim_mapping in ${plan.path}.`,
        );
      }
      if (endpoints?.issuer !== undefined && endpoints.issuer !== entry.issuer) {
        // Said out loud: a connection pointing somewhere other than the
        // vendor is not what the developer will want in the end, and nothing
        // else in the output would show it.
        reportWarning(`${entry.displayName} points at ${endpoints.issuer}, not the provider`);
      }
      const target = join(cwd, plan.path);
      await mkdir(dirname(target), { recursive: true });
      // `wx` rather than a plain write: planConnection decided this file does
      // not exist, and anything that appeared since is not ours to overwrite.
      await writeFile(target, `${stableStringify(connection)}\n`, { flag: "wx" });
      // The id first: it is the half the developer can read back afterwards,
      // and a connection missing either credential fails the same way.
      clientIdState = await publishClientId({
        name: scaffolded.clientId,
        value: clientId,
        publish,
      });
      secret = await storeClientSecret({
        name: scaffolded.clientSecret,
        value: secretValue,
        publish,
      });
      consola.success(`Wrote ${plan.path}`);
    }

    const edits = await this.enableInConfiguration(cwd, schema, plan.slug, flows);

    for (const file of edits.written) {
      consola.success(`Updated ${file}`);
    }
    for (const skipped of edits.skipped) {
      const toDo =
        skipped.step === "password"
          ? `Add ${plan.slug} to its sso_providers, and route sso_authenticated to the step a sign-in ends on, sso_user_not_found to register-sso and user_already_exists to sso-conflict.`
          : skipped.step === "sso-conflict"
            ? `Add ${plan.slug} to its sso_providers.`
            : "Update it yourself.";
      reportWarning(`Left ${skipped.region} alone: it has been edited by hand. ${toDo}`);
    }
    if (edits.written.length === 0 && edits.skipped.length === 0) {
      consola.info(`${schema.name} and its login flow already offer ${entry.displayName}`);
    }
    if (clientIdState !== undefined && idVariable !== undefined) {
      reportClientIdOutcome(
        idVariable,
        clientIdState,
        this.meta.cliVersion,
        this.environmentSelector(),
      );
    }
    if (secret) {
      // A reuse that piped nothing in had no value to publish; a create always
      // has one, because the command refuses without it.
      reportSecretOutcome(secret, this.meta.cliVersion, reusing, this.environmentSelector());
    }

    return this.emit({
      status: "ok",
      data: {
        ...this.payload({
          projectId: projectId,
          provider: selectionName(selection),
          schema: schema.name,
          plan,
          callbackUri,
          secret,
          clientId: clientIdState,
          idVariable,
          changed: edits.written,
          skipped: edits.skipped,
        }),
        // `variables set` only when the secret did not reach the project:
        // the connection references it as `${{ NAME }}` and the engine
        // resolves that from the project's variables, so a button whose
        // credential never arrived fails at token exchange. An ok result
        // carries its follow-ups in data.next_commands (errors use the
        // top-level nextCommands instead).
        ...nextCommandsData([
          ...republishCommands(
            [
              { name: idVariable, secret: false, published: clientIdState },
              { name: variable, secret: true, published: secret?.published },
            ],
            this.meta.cliVersion,
            this.environmentSelector(),
          ),
          this.suggest("plan"),
          this.suggest("apply"),
        ]),
      },
      pretty: `Enabled ${entry.displayName} for ${schema.name}`,
    });
  }

  /**
   * How the connection's credentials reach the project, or `undefined` when there is
   * no project behind this run: `--source mock` answers from fixtures and has
   * no variables to write. It publishes through the connection rather than
   * `OwnerCommand.connect` because this command addresses the local Project it
   * was pointed at, not an owner the developer named.
   */
  private publisher(client: ZitadelClient, projectId: string): SecretPublisher | undefined {
    if (this.meta.source === "mock") {
      return undefined;
    }
    return async (name, value, { secret }) => {
      await client.updateVariables({ [name]: { value, secret } }, { project_id: projectId });
    };
  }

  /**
   * The flows this provider must be added to, or a refusal.
   *
   * Called before the connection is written and before either credential is
   * published, because no flow means no button however well everything else
   * went: `plan` and `apply` both succeed and the sign-in screen simply never
   * offers the provider. Failing afterwards would leave a connection file and
   * two published variables behind for a provider that cannot be shown.
   */
  private async targetFlows(cwd: string, schema: SchemaFile): Promise<FlowFile[]> {
    const publishedSchemaId = await publishedIdOf(cwd, schema.path);
    const flows = (await readFlowFiles(cwd)).filter((flow) =>
      flowUsesSchema(flow.body, schema, publishedSchemaId),
    );
    if (flows.length === 0) {
      throw new ZitadelError("E_NOT_FOUND", `No login flow runs against ${schema.name}`, {
        hint:
          "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
          "names this schema. Check the flow's user_schema, or run `apply` first so the " +
          "schema's published id is recorded in .zitadel/state.json.",
        details: { schema: schema.path },
      });
    }
    // The editors read a region they cannot recognise as absent and write the
    // generated one over it. Refuse here, before anything is written or
    // published, rather than discard whatever a developer put there.
    refuseUneditable(schema.path, schema.body, "schema");
    for (const flow of flows) {
      refuseUneditable(flow.path, flow.body, "flow");
    }
    return flows;
  }

  private async enableInConfiguration(
    cwd: string,
    schema: SchemaFile,
    slug: ConnectionSlug,
    flows: FlowFile[],
  ): Promise<{ written: string[]; skipped: SsoSkipped[] }> {
    const methods = enabledMethods(schema);
    const schemaResult = applySsoToSchema(schema.body, slug);
    const flowResults = flows.map((flow) => ({
      flow,
      result: applySsoToFlow(flow.body, slug, methods),
    }));

    const written: string[] = [];
    const skipped: SsoSkipped[] = [];
    if (schemaResult.changed) {
      await writeFile(join(cwd, schema.path), `${stableStringify(schemaResult.document)}\n`);
      written.push(schema.path);
    }
    for (const { flow, result } of flowResults) {
      skipped.push(
        ...result.skipped.map((entry) => ({ ...entry, region: `${flow.path} ${entry.region}` })),
      );
      if (result.changed) {
        await writeFile(join(cwd, flow.path), `${stableStringify(result.document)}\n`);
        written.push(flow.path);
      }
    }
    return { written, skipped };
  }

  /** The machine-readable payload. Never the secret, only whether it is held. */
  private payload(input: {
    /**
     * The Project the run addresses. `--json` suppresses the console line that
     * otherwise carries it, and a result that names only the schema does not
     * say which Project was changed.
     */
    projectId: string;
    provider: ProviderName;
    schema: string;
    plan: ConnectionPlan;
    callbackUri: string;
    secret: SecretOutcome | undefined;
    clientId: PublishState | undefined;
    /**
     * The variable the connection names, which need not be the slug's, and is
     * `undefined` when the connection holds its client id as a literal.
     */
    idVariable: ClientIdVariable | undefined;
    changed?: string[];
    skipped?: SsoSkipped[];
  }): Record<string, unknown> {
    return {
      project_id: input.projectId,
      provider: input.provider,
      schema: input.schema,
      connection: {
        action: input.plan.action,
        slug: input.plan.slug,
        file: input.plan.action === "reuse" ? input.plan.file.path : input.plan.path,
      },
      callback_uri: input.callbackUri,
      changed: input.changed ?? [],
      untouched: (input.skipped ?? []).map((s) => s.region),
      client_id:
        input.clientId === undefined || input.idVariable === undefined
          ? null
          : { variable: input.idVariable, published: input.clientId },
      secret:
        input.secret === undefined
          ? null
          : { variable: input.secret.name, published: input.secret.published },
    };
  }
}

/** Whether a flow runs against this schema: by `objectType`, or by a revision id or URL in older files. */
function flowUsesSchema(
  flow: Record<string, unknown>,
  schema: SchemaFile,
  publishedSchemaId: string | undefined,
): boolean {
  const used = flow.user_schema;
  if (typeof used !== "string") {
    return false;
  }
  const objectType = schema.body.objectType;
  if (typeof objectType === "string" && used === objectType) {
    return true;
  }
  // Once a Project has been applied, the flow names the schema by the id the
  // platform assigned, which `.zitadel/state.json` records against the schema
  // file. Before that it still carries the scaffolded URL.
  if (publishedSchemaId !== undefined && used === publishedSchemaId) {
    return true;
  }
  const id = schema.body.$id;
  if (typeof id === "string") {
    // An `$id` is the schema's own statement of what flows name it by, so a
    // flow that names something else is about a different schema — even when
    // the two URLs end in the same file name. Guessing past a disagreement is
    // how `sso enable` would edit the wrong flow.
    return id === used;
  }
  // No `$id` to go on: a Project scaffolded but never applied names the
  // schema by the URL setup wrote, whose last segment is the file name.
  return used.endsWith(`/${schema.name}.json`);
}

/** Stop on a document whose region the SSO editors would overwrite. */
function refuseUneditable(path: string, body: object, target: SsoEditTarget): void {
  const refusal = ssoEditRefusal(body, target);
  if (refusal === undefined) {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${path}: ${refusal}`, {
    hint:
      "Enabling a provider edits this file, and that region is not the shape it edits. " +
      "Fix it against the dialect in .zitadel/meta/, then run the command again.",
    details: { file: path, region: refusal },
  });
}

/**
 * The platform id a local file was last synced as, from `.zitadel/state.json`.
 * Absent before the first `apply`, and absent entirely on a Project that has
 * never synced — both mean "fall back to matching on the scaffolded URL".
 *
 * Only a missing file falls back. A malformed or unreadable state file is the
 * authoritative record failing to answer, and the fallback matches on a URL
 * suffix rather than an id, so it could pick a flow bound to a different
 * schema. Saying so beats editing the wrong flow quietly.
 */
async function publishedIdOf(cwd: string, path: string): Promise<string | undefined> {
  try {
    const state = await readState(cwd);
    return state.resources?.[path]?.id;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return undefined;
    }
    throw new ZitadelError(
      "E_VALIDATION",
      `Cannot read .zitadel/state.json: ${error instanceof Error ? error.message : String(error)}`,
      {
        hint:
          "The file records which platform resource each local file was synced as. " +
          "Fix or remove it and run `zitadel apply`, then run this command again.",
        details: { file: ".zitadel/state.json" },
      },
    );
  }
}
