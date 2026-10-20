import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { intro, outro } from "@clack/prompts";
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
  parseClientSecret,
  type ProviderName,
  type ProviderSelection,
  providerOf,
  selectionName,
  validated,
} from "@zitadel/config/idp";

import { createZitadelClient } from "../../../lib/api-client";
import { refuseBrokenFlows, refuseUneditable } from "../../../lib/auth-methods";
import { isDevelopmentBuild } from "../../../lib/build-channel";
import { ZitadelError } from "../../../lib/errors";
import { stableStringify } from "../../../lib/json";
import {
  applyRequest,
  applySsoToFlow,
  asksForClaims,
  askClaims,
  claimFlagText,
  claimNotes,
  claimRequestFromFlags,
  claimsOrRefuse,
  ENABLE_CLAIM_FLAGS,
  type MappingState,
  seedMapping,
  summariseClaims,
  withClaims,
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
  registrationLines,
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
import {
  readDevelopmentIssuer,
  readZitadelConfig,
  readZitadelSecret,
  type ZitadelSecret,
} from "../../../lib/project";
import { portableCommands, publicCliCommand } from "../../../lib/public-cli";
import { reportWarning } from "../../../lib/warnings";
import { Wizard } from "../../../lib/wizard";

/**
 * The `auth-method sso enable` command (ADR 070) — add a provider to a
 * Project's sign-in methods. It replaces the former `sso enable`.
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
export default class AuthMethodSsoEnable extends AuthMethodCommand {
  static override description = "Add an identity provider to a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method sso enable --provider google",
    "<%= config.bin %> auth-method sso enable --provider google --schema customers",
    "<%= config.bin %> auth-method sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt",
    `<%= config.bin %> auth-method sso enable ${customExample(ENABLE_FLAG_NAMES)}`,
    `<%= config.bin %> auth-method sso enable ${customExample(ENABLE_FLAG_NAMES, true)} --client-id abc123 --non-interactive < secret.txt`,
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
    "client-id": nonBlankString({
      description: "Client id of the application registered with the provider.",
    }),
    claim: Flags.string({
      multiple: true,
      description:
        "Fill a user-schema property from a provider claim: <property>=<claim>, e.g. staffNumber=employee_id:integer. A claim the provider returns as a number or boolean says so after a colon (string is the default). Repeatable. Given, it replaces the interactive claim questions; the standard claims whose names match the schema are mapped either way, and a claim you give replaces the default for its property.",
    }),
    "verified-claim": Flags.string({
      multiple: true,
      description:
        "Say how a mapped property is verified: <property>=<claim> names the boolean claim that must be true, <property>=true trusts the provider. Repeatable.",
    }),
    "claim-scope": nonBlankString({
      description:
        "Extra scopes the mapped claims need before the provider returns them, separated by spaces or commas.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthMethodSsoEnable);
    const {
      cwd,
      cwdArgs,
      schema,
      flows: candidates,
      preflight: { selection, entry, secretFile, issuer },
    } = await this.target(flags, {
      // The credentials are published to the project, so the server is
      // resolved, unlike for the other auth-method commands.
      resolveServer: true,
      preflight: (cwd) => readProject(cwd, flags),
    });
    const { nonInteractive, dryRun, cliVersion } = this.meta;
    const provider = selectionName(selection);
    // What an agent can run once the missing credential is to hand. Only for a
    // catalog provider: a custom connection needs its settings repeated too.
    // `--cwd` only when it can be written unquoted on every shell.
    const cwdText = portableCommands([cwdArgs], cliVersion).length > 0 ? cwdArgs : [];
    const claimRequest = claimRequestFromFlags(
      { claim: flags.claim, scope: flags["claim-scope"], verified: flags["verified-claim"] },
      ENABLE_CLAIM_FLAGS,
    );
    const claimsGiven = asksForClaims(claimRequest);
    // The claims travel in the retry: a rerun that dropped them would create the
    // connection with the defaults and report success.
    const claimText = claimsGiven ? [claimFlagText(claimRequest, ENABLE_CLAIM_FLAGS)] : [];
    const retryFor = (clientId: string, pipe = ""): string | undefined =>
      selection.kind === "catalog"
        ? `${pipe}${publicCliCommand(
            [
              "auth-method sso enable --provider",
              provider,
              "--client-id",
              clientId,
              ...claimText,
              ...cwdText,
            ].join(" "),
            cliVersion,
          )}`
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
    // The mapping a new connection will carry, checked against the schema now,
    // before a secret is asked for or a file is written, like the edits below.
    // A reused connection keeps the mapping it has: it is the developer's file.
    const mapped = reusing
      ? undefined
      : claimsOrRefuse(
          applyRequest(
            seedMapping(
              entry.connection({
                slug: plan.slug,
                schemaProperties: schema.properties,
                schemaRef: CONNECTION_SCHEMA_REF,
              }),
              schema.attributes,
            ),
            claimRequest,
          ),
          "",
        );
    for (const note of mapped === undefined ? [] : claimNotes(mapped)) {
      reportWarning(note);
    }
    if (reusing && claimsGiven) {
      reportWarning(
        `${plan.file.path} already exists, so the claims you gave were not applied. Edit claim_mapping in the file to change them.`,
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
    // refusal (an edit the editors cannot make, or a flow `plan` would then
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

    consola.info(`Project   ${secretFile.project_id}`);
    consola.info(
      `Schema    ${schema.path}${schema.methods.length > 0 ? ` (${schema.methods.join(", ")})` : ""}`,
    );

    if (dryRun) {
      this.reportOutcome(outcome);
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: this.payload({
          projectId: secretFile.project_id,
          provider,
          schema: schema.name,
          plan,
          callbackUri,
          secret: undefined,
          clientId: undefined,
          idVariable,
          changed: editedFiles(schema, edits),
          claims: mapped,
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
    let createdClaims: MappingState | undefined;

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
      const publish = this.publisher(secretFile);
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

      if (mapped === undefined) {
        throw new Error("a connection being created has a claim mapping");
      }
      // A person at a terminal is walked through it as a wizard; a script or an
      // agent gets the same facts as log lines and answers by flag.
      const wizard = new Wizard({ ask: this.input });
      const registration = registrationLines(entry, callbackUri, endpoints?.issuer);
      if (nonInteractive) {
        consola.info(registration.join("\n"));
      } else {
        intro(`Add "${entry.displayName}"`);
        wizard.say(registration);
      }
      const clientId = await wizard.ask({
        kind: "text",
        name: `client id for ${entry.displayName}`,
        message: "What is the OAuth client ID?",
        flag: "--client-id",
        parse: parseClientId,
        given: flags["client-id"],
        retry: retryFor("<client-id>"),
      });
      // Required, like the client id. The connection document references the
      // secret as `${{ NAME }}` and the engine resolves that from the project's
      // variables, so enabling a provider without one writes a sign-in button
      // that fails at the token endpoint with `invalid_client` -- a failure that
      // surfaces in a browser, not here. Refusing now is the cheaper answer.
      const secretValue = await wizard.ask({
        kind: "secret",
        name: `client secret for ${scaffolded.clientSecret}`,
        message: "What is the OAuth client secret?",
        parse: parseClientSecret,
        stdin: true,
        retry: retryFor(clientId, `printf '%s' "$CLIENT_SECRET" | `),
      });

      // Flags that name claims are the whole answer, as `--preset` is for its
      // question; a run nobody can answer takes the defaults.
      const claims =
        nonInteractive || claimsGiven
          ? mapped
          : claimsOrRefuse(
              applyRequest(mapped, await askClaims(mapped, wizard, entry.displayName)),
              "",
            );
      if (!nonInteractive) {
        outro("Configuration captured");
      }
      createdClaims = claims;
      const heard = new Set(claimNotes(mapped));
      for (const note of claimNotes(claims)) {
        if (!heard.has(note)) {
          reportWarning(note);
        }
      }

      const publish = this.publisher(secretFile);
      const connection = withClaims(
        entry.connection({
          slug: plan.slug,
          schemaProperties: schema.properties,
          schemaRef: CONNECTION_SCHEMA_REF,
          endpoints,
        }),
        claims,
      );
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
      consola.info(`Claims in ${plan.path}:\n  ${summariseClaims(claims).join("\n  ")}`);
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
      reportClientIdOutcome(idVariable, clientIdState, this.meta.cliVersion);
    }
    if (secret) {
      // A reuse that piped nothing in had no value to publish; a create always
      // has one, because the command refuses without it.
      reportSecretOutcome(secret, this.meta.cliVersion, reusing);
    }
    this.reportOutcome(outcome);
    // `variables set` first, for a credential that did not reach the project:
    // the connection references it as `${{ NAME }}` and the engine resolves
    // that from the project's variables, so a button whose credential never
    // arrived fails at token exchange. Then plan and apply, when a file
    // changed. All carry --cwd when the run did.
    const recovery = republishArgs(
      [
        { name: idVariable, secret: false, published: clientIdState },
        { name: variable, secret: true, published: secret?.published },
      ],
      cwdArgs,
    );

    return this.emit({
      status: "ok",
      data: {
        ...this.payload({
          projectId: secretFile.project_id,
          provider,
          schema: schema.name,
          plan,
          callbackUri,
          secret,
          clientId: clientIdState,
          idVariable,
          changed: written,
          skipped: edits.skipped,
          claims: createdClaims,
        }),
        // An ok result carries its follow-ups in data.next_commands (errors
        // use the top-level nextCommands instead).
        ...this.followUps(!reusing || written.length > 0, cwdArgs, recovery),
      },
      pretty: `Enabled ${entry.displayName} for ${schema.name}`,
    });
  }

  /**
   * How the connection's credentials reach the project, or `undefined` when
   * there is no project behind this run: `--source mock` answers from fixtures
   * and has no variables to write. The connection is built here rather than
   * taken from `OwnerCommand.connect` because this command addresses the local
   * Project it was pointed at, not an owner the developer named.
   */
  private publisher(secret: ZitadelSecret): SecretPublisher | undefined {
    const { source } = this.meta;
    if (source === "mock") {
      return undefined;
    }
    const client = createZitadelClient({ baseUrl: source, token: secret.project_secret });
    return async (name, value, { secret: isSecret }) => {
      await client.updateVariables(
        { [name]: { value, secret: isSecret } },
        { project_id: secret.project_id },
      );
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
    /** What a connection this run creates maps and requests. */
    claims?: MappingState;
  }): Record<string, unknown> {
    return {
      project_id: input.projectId,
      provider: input.provider,
      schema: input.schema,
      connection: {
        action: input.plan.action,
        slug: input.plan.slug,
        file: input.plan.action === "reuse" ? input.plan.file.path : input.plan.path,
        ...(input.claims === undefined
          ? {}
          : {
              claim_mapping: input.claims.mapping,
              verified_claims: input.claims.verified,
              scopes: input.claims.scopes,
            }),
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
  readonly secretFile: ZitadelSecret;
  readonly issuer: string;
};

/**
 * The provider to enable and the Project it is enabled for, or a refusal.
 *
 * The provider and a custom connection's settings are checked first, before
 * the Project is read: a name or issuer the server would refuse on apply is
 * refused here, where it was typed. The Project is read before anything is
 * asked for: being turned away after typing a secret would mean typing it
 * again.
 *
 * @param cwd - The Project directory.
 * @param flags - `--provider`, which is named rather than prompted for, and
 *   the custom connection's settings.
 */
async function readProject(
  cwd: string,
  flags: { readonly [K in (typeof ENABLE_FLAG_KEYS)[keyof typeof ENABLE_FLAG_KEYS]]?: string },
): Promise<ProjectContext> {
  const provider = flags[ENABLE_FLAG_KEYS.provider];
  if (provider === undefined) {
    // Named rather than prompted for: the catalog holds one provider today,
    // and a question offering a single answer is a keystroke, not a choice
    // (the same reasoning `OwnerCommand` gives for requiring an owner).
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
  const loopback = loopbackIssuerWarning(selection);
  if (loopback !== undefined) {
    reportWarning(loopback);
  }
  const entry = providerOf(selection);
  const config = await readZitadelConfig(cwd);
  const secretFile = await readZitadelSecret(cwd);
  const issuer = readDevelopmentIssuer(config);
  if (issuer === undefined) {
    throw new ZitadelError("E_VALIDATION", "This Project has no development issuer", {
      hint: "Run `zitadel setup` first, or add environments.development.issuer to zitadel.json.",
    });
  }
  return { selection, entry, secretFile, issuer };
}

/**
 * The flows this provider must be added to, or a refusal.
 *
 * Called before the connection is written and before either credential is
 * published, because no flow means no button however well everything else
 * went: `plan` and `apply` both succeed and the sign-in screen simply never
 * offers the provider. Failing afterwards would leave a connection file and
 * two published variables behind for a provider that cannot be shown.
 *
 * @param schema - The schema the provider is enabled for.
 * @param flows - The flows that run against it.
 */
function targetFlows(schema: SchemaFile, flows: FlowFile[]): FlowFile[] {
  if (flows.length === 0) {
    throw new ZitadelError("E_NOT_FOUND", `No login flow runs against ${schema.name}`, {
      hint:
        "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
        "names this schema. Check the flow's user_schema, or run `zitadel apply` first so the " +
        "schema's published id is recorded in .zitadel/state.json.",
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
