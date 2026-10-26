import { clientIdQuestion, clientSecretQuestion } from "../../../lib/questions";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Flags } from "@oclif/core";
import { consola } from "consola";

import {
  type ClientIdVariable,
  type ConnectionSlug,
  credentialVariables,
  CUSTOM_PROVIDER,
  type IdpProvider,
  IDP_PROVIDERS,
  parseClientId,
  type ProviderName,
  type ProviderSelection,
  providerOf,
  selectionName,
  validated,
} from "@zitadel/config/idp";

import type { ZitadelClient } from "../../../lib/api-client";
import { loopbackReach } from "../../../lib/local-server/runtime";
import { refuseBrokenFlows, refuseUneditable } from "../../../lib/auth-methods";
import { isDevelopmentBuild } from "../../../lib/build-channel";
import { ZitadelError } from "../../../lib/errors";
import { stableStringify } from "../../../lib/json";
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
  reportClientIdOutcome,
  republishArgs,
  selectionFromFlags,
  type StoredVariables,
  ssoEditRefusal,
  type SsoResult,
  type SsoSkipped,
  reportSecretOutcome,
  storeClientSecret,
  type SchemaFile,
  type SecretOutcome,
  type SecretPublisher,
} from "../../../lib/idp";
import {
  AuthMethodCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../../lib/oclif";
import { environmentFlags } from "../../../lib/oclif/environment-flags";
import { inShell, type SuggestedCommand } from "../../../lib/suggestion";
import { reportWarning } from "../../../lib/warnings";

/**
 * The `auth-method sso enable` command (ADR 070) — add a provider to a
 * Project's sign-in methods. It replaces the former `sso enable`.
 *
 * One direct journey: the developer is told what to register with the
 * provider, gives back the credentials, and the Project's configuration is
 * written. It works on the local Project `zitadel setup` created and does not
 * require claiming, because this is the local development path.
 *
 * The client secret never comes from a flag, following `variable set`: it is
 * prompted for, or read from stdin when scripting, so it cannot land in shell
 * history, a process listing, or CI logs.
 */
export default class AuthMethodSsoEnable extends AuthMethodCommand {
  static override description = "Add an identity provider to a user schema.";
  static override group = CommandGroups.authentication;
  static override examples = [
    "<%= config.bin %> auth-method sso enable --provider google",
    "<%= config.bin %> auth-method sso enable --provider google --schema customers",
    "<%= config.bin %> auth-method sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt",
    `<%= config.bin %> auth-method sso enable ${customExample(ENABLE_FLAG_NAMES)}`,
    `<%= config.bin %> auth-method sso enable ${customExample(ENABLE_FLAG_NAMES, true)} --client-id abc123 --non-interactive < secret.txt`,
  ];
  // The one `auth-method` command that resolves an environment, so the one that
  // lists `--env` and `--env-file`; the others hide them.
  static override baseFlags = { ...AuthMethodCommand.baseFlags, ...environmentFlags };
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
    "client-id": nonBlankString({
      description: "Client id of the application registered with the provider.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthMethodSsoEnable);
    const {
      cwd,
      schema,
      flows: candidates,
      preflight: { selection, entry, issuer },
    } = await this.target(flags, {
      // The credentials are published to the project, so the environment is
      // resolved, unlike for the other auth-method commands.
      resolveServer: true,
      preflight: () => readProject(flags, this.environment.values.ZITADEL_ISSUER?.value),
    });
    // Resolved before anything is asked for: being turned away after typing a
    // secret would mean typing it again.
    const { client, projectId, server } = await this.connect({ quiet: true });
    const { nonInteractive, dryRun } = this.meta;
    // A loopback issuer works only on a server that may fetch from this machine.
    const loopback = loopbackIssuerWarning(selection, await loopbackReach(cwd, server));
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    const provider = selectionName(selection);
    // `--cwd` and the run's `--env`/`--env-file`/`--server`, so every follow-up
    // reaches the project this run published to.
    const scopeArgs = this.environmentSelectorArgs();
    // What an agent can run once the missing credential is to hand. Only for a
    // catalog provider: a custom connection needs its settings repeated too.
    const retryFor = (clientId: string, pipe = ""): SuggestedCommand | undefined =>
      selection.kind === "catalog"
        ? inShell(
            this.suggest(`auth-method sso enable --provider ${provider} --client-id ${clientId}`),
            { before: pipe },
          )
        : undefined;

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
    // The connection's own route, so the slug decides it: a reused connection
    // keeps the slug it was created with.
    const callbackUri = callbackUriFor(issuer, plan.slug);

    const reusing = plan.action === "reuse";
    if (plan.action === "create" && plan.alsoUsesIssuer !== undefined) {
      reportWarning(
        `${plan.alsoUsesIssuer.join(", ")} already connects to ${provider}'s issuer under another slug, so this adds a second ${provider} connection and button.`,
      );
    }
    if (plan.action === "reuse" && plan.notApplied !== undefined) {
      reportWarning(
        `${plan.file.path} already exists, so the ${plan.notApplied.join(" and ")} you gave ${plan.notApplied.length === 1 ? "was" : "were"} not applied. Edit the file to change ${plan.notApplied.length === 1 ? "it" : "them"}.`,
      );
    }
    // What a newly written connection will reference: this command writes both
    // as `${{ NAME }}`, so on the create path the names are certain.
    const scaffolded = credentialVariables(plan.slug);
    // A reused connection may name its own variables — it is an editable file
    // — so the credentials go where it actually looks rather than where this
    // command would have put them. A name is `undefined` when the file holds
    // that credential as a literal: there is no variable to publish to, and
    // publishing to a derived name would report success for a value the
    // connection never reads.
    const names: StoredVariables = reusing
      ? credentialVariablesOf(plan.file, plan.slug)
      : scaffolded;
    const variable = names.clientSecret;
    const idVariable = names.clientId;

    // Before the dry-run return: a Project whose flows all name another
    // schema must fail identically either way, or the preview says "would
    // create" for a run that cannot succeed.
    const flows = targetFlows(schema, candidates);
    // The schema and flow edits are worked out now, before the dry-run return
    // and before the connection is written or a credential published, so a
    // refusal (an edit the editors cannot make, or a flow `deploy` would then
    // reject) stops the run with nothing changed (ADR 070 §3).
    const edits = planEdits(schema, plan.slug, flows);
    refuseBrokenFlows(
      schema,
      edits.schema.document as Record<string, unknown>,
      edits.flows.map(({ flow, result }) => ({
        file: flow,
        after: result.document as Record<string, unknown>,
      })),
    );
    const outcome = {
      schema,
      before: schema.body,
      after: edits.schema.document as Record<string, unknown>,
      flowsAfter: edits.flows.map(({ result }) => result.document as Record<string, unknown>),
    };

    consola.info(`Project   ${projectId}`);
    consola.info(
      `Schema    ${schema.path}${schema.methods.length > 0 ? ` (${schema.methods.join(", ")})` : ""}`,
    );

    if (dryRun) {
      this.reportOutcome(outcome);
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: this.payload({
          projectId,
          provider,
          schema: schema.name,
          plan,
          callbackUri,
          secret: undefined,
          clientId: undefined,
          idVariable,
          changed: editedFiles(schema, edits),
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
      // Shown on reuse too: the URI moved to one per connection after the
      // first release, and rerunning this command is how a developer finds
      // the one to register now.
      consola.info(`Callback URI   ${callbackUri}`);
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
        ...clientSecretQuestion({ provider: entry.displayName }),
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
        ...clientIdQuestion(entry.displayName),
        flag: "--client-id",
        given: flags["client-id"],
        retry: retryFor("<client-id>"),
      });
      // Required, like the client id. The connection document references the
      // secret as `${{ NAME }}` and the engine resolves that from the project's
      // variables, so enabling a provider without one writes a sign-in button
      // that fails at the token endpoint with `invalid_client` -- a failure
      // that surfaces in a browser, not here. Refusing now is the cheaper answer.
      const secretValue = await this.input({
        ...clientSecretQuestion({
          provider: entry.displayName,
          variable: scaffolded.clientSecret,
        }),
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
      // of them leaves it with no mapping, and `deploy` refuses a connection that
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

    const written = await this.enableInConfiguration(cwd, schema, edits);

    for (const file of written) {
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
    if (written.length === 0 && edits.skipped.length === 0) {
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
    this.reportOutcome(outcome);
    // `variable set` first, for a credential that did not reach the project:
    // the connection references it as `${{ NAME }}` and the engine resolves
    // that from the project's variables, so a button whose credential never
    // arrived fails at token exchange. Then deploy, when a file
    // changed. All carry --cwd when the run did.
    const recovery = republishArgs(
      [
        { name: idVariable, secret: false, published: clientIdState },
        { name: variable, secret: true, published: secret?.published },
      ],
      scopeArgs,
    );

    // A file changed or a connection was created, which only a deploy publishes.
    const unpublished = !reusing || written.length > 0;
    const credentialsStored =
      secret?.published === "stored" && (clientIdState === undefined || clientIdState === "stored");
    const stored = credentialsStored ? ["Provider credentials are stored on your Project."] : [];
    const name = entry.displayName;

    return this.emit({
      status: "ok",
      data: {
        // Configured is not live, and stored credentials are only claimed once
        // they reached the Project (a failed or deferred publish warns instead).
        title: unpublished
          ? [`${name} sign-in is configured locally.`, ...stored].join(" ")
          : `${name} sign-in is already configured locally.`,
        ...(unpublished
          ? {
              next_actions: [
                `Deploy the configuration to make ${name} sign-in available in your app, then reload your app and test ${name} sign-in.`,
              ],
            }
          : {}),
        ...this.payload({
          projectId,
          provider,
          schema: schema.name,
          plan,
          callbackUri,
          secret,
          clientId: clientIdState,
          idVariable,
          changed: written,
          skipped: edits.skipped,
        }),
        // An ok result carries its follow-ups in data.next_commands (errors
        // use the top-level nextCommands instead).
        ...this.followUps(unpublished, scopeArgs, recovery),
      },
    });
  }

  /**
   * How the connection's credentials reach the project, or `undefined` when
   * there is no project behind this run: `--source mock` answers from fixtures
   * and has no variables to write. It publishes to the project's own variables,
   * which is where the engine resolves a connection's `${{ NAME }}` references
   * from.
   */
  private publisher(client: ZitadelClient, projectId: string): SecretPublisher | undefined {
    if (this.meta.source === "mock") {
      return undefined;
    }
    return async (name, value, { secret }) => {
      await client.updateVariables({ [name]: { value, secret } }, { project_id: projectId });
    };
  }

  /** Write the edits `planEdits` worked out, and say which files changed. */
  private async enableInConfiguration(
    cwd: string,
    schema: SchemaFile,
    edits: PlannedEdits,
  ): Promise<string[]> {
    if (edits.schema.changed) {
      await writeFile(join(cwd, schema.path), `${stableStringify(edits.schema.document)}\n`);
    }
    for (const { flow, result } of edits.flows) {
      if (result.changed) {
        await writeFile(join(cwd, flow.path), `${stableStringify(result.document)}\n`);
      }
    }
    return editedFiles(schema, edits);
  }

  /**
   * The machine-readable payload. Never the secret, only whether it is held.
   */
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

/** What the run needs from the Project before the schema is read. */
type ProjectContext = {
  readonly selection: ProviderSelection;
  readonly entry: IdpProvider;
  readonly issuer: string;
};

/**
 * The provider to enable and the Project it is enabled for, or a refusal.
 *
 * The provider and a custom connection's settings are checked first, before
 * the Project is read: a name or issuer the server would refuse on deploy is
 * refused here, where it was typed. The Project is read before anything is
 * asked for: being turned away after typing a secret would mean typing it
 * again.
 *
 * @param flags - `--provider`, which is named rather than prompted for, and
 *   the custom connection's settings.
 * @param issuer - The origin the app serves from, from the environment.
 */
async function readProject(
  flags: { readonly [K in (typeof ENABLE_FLAG_KEYS)[keyof typeof ENABLE_FLAG_KEYS]]?: string },
  issuer: string | undefined,
): Promise<ProjectContext> {
  const provider = flags[ENABLE_FLAG_KEYS.provider];
  if (provider === undefined) {
    // Named rather than prompted for: the catalog holds one provider today,
    // and a question offering a single answer is a keystroke, not a choice.
    throw new ZitadelError("E_VALIDATION", "Name the provider to enable", {
      hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}.`,
    });
  }
  const selection = selectionFromFlags(
    provider,
    customFlagValues(flags, ENABLE_FLAG_KEYS),
    ENABLE_FLAG_NAMES,
    customExample(ENABLE_FLAG_NAMES),
  );
  const entry = providerOf(selection);
  if (issuer === undefined) {
    throw new ZitadelError("E_VALIDATION", "This Project has no development issuer", {
      hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
    });
  }
  return { selection, entry, issuer };
}

/**
 * The flows this provider must be added to, or a refusal.
 *
 * Called before the connection is written and before either credential is
 * published, because no flow means no button however well everything else
 * went: `deploy` succeeds and the sign-in screen simply never offers the
 * provider. Failing afterwards would leave a connection file and two
 * published variables behind for a provider that cannot be shown.
 *
 * @param schema - The schema the provider is enabled for.
 * @param flows - The flows that run against it.
 */
function targetFlows(schema: SchemaFile, flows: FlowFile[]): FlowFile[] {
  if (flows.length === 0) {
    throw new ZitadelError("E_NOT_FOUND", `No login flow runs against ${schema.name}`, {
      hint:
        "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
        "names this schema. Check that the flow's user_schema names the schema's objectType.",
      details: { schema: schema.path },
    });
  }
  // The editors read a region they cannot recognise as absent and write the
  // generated one over it. Refuse here, before anything is written or
  // published, rather than discard whatever a developer put there.
  refuseUneditable(schema.path, ssoEditRefusal(schema.body, "schema"));
  for (const flow of flows) {
    refuseUneditable(flow.path, ssoEditRefusal(flow.body, "flow"));
  }
  return flows;
}

/** The schema and flow edits a run will make, before anything is written. */
type PlannedEdits = {
  readonly schema: SsoResult<object>;
  readonly flows: ReadonlyArray<{ flow: FlowFile; result: SsoResult<object> }>;
  /** Hand-edited regions the flow editors leave alone, named by file. */
  readonly skipped: SsoSkipped[];
};

/**
 * Enable the provider in the schema and every login flow that runs against
 * it, without writing anything. A flow belonging to another schema is left
 * alone: enabling Google for customers must not touch the employee journey.
 * The editors are pure and throw their refusals, so calling this before any
 * write or publish is what makes those refusals leave nothing behind.
 */
function planEdits(
  schema: SchemaFile,
  slug: ConnectionSlug,
  flows: readonly FlowFile[],
): PlannedEdits {
  const methods = enabledMethods(schema);
  const results = flows.map((flow) => ({ flow, result: applySsoToFlow(flow.body, slug, methods) }));
  return {
    schema: applySsoToSchema(schema.body, slug),
    flows: results,
    skipped: results.flatMap(({ flow, result }) =>
      result.skipped.map((entry) => ({ ...entry, region: `${flow.path} ${entry.region}` })),
    ),
  };
}

/** The project-relative files the planned edits change. */
function editedFiles(schema: SchemaFile, edits: PlannedEdits): string[] {
  return [
    ...(edits.schema.changed ? [schema.path] : []),
    ...edits.flows.filter(({ result }) => result.changed).map(({ flow }) => flow.path),
  ];
}
