import { VariableService, VariableWrite, type ZitadelClient } from "@/lib/backend";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Flags } from "@oclif/core";
import { consola } from "consola";
import { z } from "zod";

import {
  type ClientId,
  type ClientIdVariable,
  type ConnectionSlug,
  credentialVariables,
  CUSTOM_PROVIDER,
  DEFAULT_SCOPES,
  IDP_PROVIDERS,
  parseClientId,
  parseClientSecret,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  type Parsed,
  parseScopes,
  type ProviderName,
  providerOf,
  type ProviderSelection,
  RESERVED_SLUGS,
  selectionName,
  validated,
} from "@zitadel/config/idp";

import { loopbackReach } from "@/lib/local-server/runtime";
import { refuseBrokenFlows } from "@/lib/auth-methods";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { ZitadelError } from "@/lib/errors";
import { stableStringify } from "@/lib/json";
import {
  applySsoToFlow,
  applySsoToSchema,
  askConnectionEndpoints,
  callbackUriFor,
  checkCustomSlug,
  CONNECTION_SCHEMA_REF,
  enabledMethods,
  type ConnectionFile,
  type ConnectionPlan,
  type FlowFile,
  credentialVariablesOf,
  type CustomFlagValues,
  customExample,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  loopbackIssuerWarning,
  planConnection,
  publishClientId,
  type PublishState,
  readConnectionFiles,
  refuseChangedIssuer,
  reportClientIdOutcome,
  republishArgs,
  selectionFromFlags,
  type StoredVariables,
  type SsoResult,
  type SsoSkipped,
  reportSecretOutcome,
  storeClientSecret,
  storedCustomSettings,
  type SchemaFile,
  type SecretOutcome,
  type SecretPublisher,
} from "@/lib/idp";
import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { AuthMethodCommand } from "@/commands/auth-method/command";
import type { SchemaTarget } from "@/commands/auth-method/command";
import { environmentFlags } from "@/lib/oclif/environment-flags";
import { DEPLOY_ARGS, inShell, type SuggestedCommand } from "@/lib/suggestion";
import { reportWarning } from "@/lib/warnings";
import { refuseUneditable } from "@/lib/auth-methods";
import { resolveEnvironment } from "@/lib/environment";
import {
  customFlagValues,
  selectionFromFlags as selectionFromGivenFlags,
  ssoEditRefusal as editRefusalFor,
} from "@/lib/idp";
import { filled, reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * The provider the run was asked for. `selection` is undefined for a custom
 * provider whose settings a person will be asked for once everything that can
 * fail has passed; `values` are the settings the flags gave. A person at a
 * terminal is asked for the settings they left out, but later: here the ones
 * they did give are only checked. A script, a dry run or `--non-interactive`
 * is held to the flags and told which are missing.
 */
type SsoProvider = {
  readonly selection: ProviderSelection | undefined;
  readonly values: CustomFlagValues;
};

function hasAllCustomSettings(values: CustomFlagValues): boolean {
  return (
    values.slug !== undefined && values.displayName !== undefined && values.issuer !== undefined
  );
}

/**
 * The client id a value holds, trimmed as the one a prompt would have
 * accepted. Refuses a blank value, naming the flag; `parseClientId` then
 * blesses what is left as one the provider could have issued.
 */
const CLIENT_ID: Refused<ClientId> = {
  schema: filled.transform((id) => {
    return validated(parseClientId(id));
  }),
  refusal: {
    message: "{input} was given an empty value",
    hint: "Pass a value for {input}, or omit it entirely.",
  },
};

/**
 * One of the settings that describe a custom connection, refused with what
 * the platform's own parser found wrong with it. The flag names itself in the
 * refusal, because a run gives four of them and the complaint belongs to one.
 * `setup` declares the same settings under its own `--sso-*` names.
 */
function settingFlag(flag: string, parse: (value: string) => Parsed<unknown>) {
  return Flags.custom<string>({
    parse: reads({
      schema: filled.transform((value, ctx) => {
        const parsed = parse(value);
        if (!parsed.ok) {
          ctx.addIssue({
            code: "custom",
            message: parsed.problem,
          });
          return z.NEVER;
        }
        return value;
      }),
      refusal: {
        message: `${flag}: {problem}`,
        hint: `Fix ${flag} and run the command again.`,
        details: {
          flag,
        },
      },
    }),
  });
}

/**
 * How a run that names no provider is refused. `--provider` is not oclif's
 * `required` so that its own refusal, which carries no hint, never answers
 * first; this one names the next move.
 */
const PROVIDER_IS_NAMED_REFUSAL: Refusal = {
  message: "Name the provider to enable",
  hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}.`,
};

/** What the flags say about the provider to add. */
export function ssoProvider(
  flags: { readonly [K in (typeof ENABLE_FLAG_KEYS)[keyof typeof ENABLE_FLAG_KEYS]]?: string },
  run: { interactive: boolean },
): SsoProvider {
  const provider = String(flags.provider);
  const values = customFlagValues(flags, ENABLE_FLAG_KEYS);
  // Each setting was refused under its own flag on its way in, so a run that
  // will ask for the rest has nothing left to check: the settings that were
  // given are already good, and being turned away after typing a secret would
  // mean typing it again.
  const askLater = provider === CUSTOM_PROVIDER && run.interactive && !hasAllCustomSettings(values);
  return {
    selection: askLater
      ? undefined
      : selectionFromGivenFlags(
          provider,
          values,
          ENABLE_FLAG_NAMES,
          customExample(ENABLE_FLAG_NAMES),
        ),
    values,
  };
}

/** What a project with no development issuer is refused for. */
const NO_ISSUER_REFUSAL: Refusal = {
  message: "This project has no development issuer",
  hint: "Set the project up first, or set ZITADEL_ISSUER to the origin your app serves from.",
  next: ["setup"],
};

/**
 * The origin the app serves from, as the run's environment names it. A Project
 * that has none has not been set up.
 */
export async function developmentIssuer(
  cwd: string,
  flags: {
    server?: string | undefined;
    env?: string | undefined;
    envFile?: string | undefined;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const environment = await resolveEnvironment({
    cwd,
    env,
    serverFlag: flags.server,
    envName: flags.env,
    envFile: flags.envFile,
  });
  const issuer = environment.values.ZITADEL_ISSUER?.value;
  if (issuer === undefined) {
    throw refusalError(NO_ISSUER_REFUSAL, {});
  }
  return issuer;
}

/** What a schema no login flow runs against is refused for. */
const NO_FLOW_REFUSAL: Refusal = {
  code: "E_NOT_FOUND",
  message: "No login flow runs against {schema}",
  hint:
    "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
    "names this schema. Check that the flow's user_schema names the schema's objectType.",
  details: {
    schema: "{path}",
  },
};

/**
 * The flows a provider must be added to. No flow means no button however well
 * everything else went, so a run without one is refused before anything is
 * asked or written, as is a schema or flow with a region the editors cannot
 * recognise and would write over.
 */
export function ssoFlows(target: SchemaTarget): FlowFile[] {
  const { schema, flows } = target;
  if (flows.length === 0) {
    throw refusalError(NO_FLOW_REFUSAL, {
      schema: schema.name,
      path: schema.path,
    });
  }
  refuseUneditable(schema.path, editRefusalFor(schema.body, "schema"));
  for (const flow of flows) {
    refuseUneditable(flow.path, editRefusalFor(flow.body, "flow"));
  }
  return flows;
}

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

  static override heading = "Enabling single sign-on";

  static override examples = [
    "<%= config.bin %> auth-method sso enable --provider google",
    "<%= config.bin %> auth-method sso enable --provider google --schema customers",
    "<%= config.bin %> auth-method sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt",
    `<%= config.bin %> auth-method sso enable ${customExample(ENABLE_FLAG_NAMES)}`,
    `<%= config.bin %> auth-method sso enable ${customExample(ENABLE_FLAG_NAMES, true)} --client-id abc123 --non-interactive < secret.txt`,
  ];
  static override baseFlags = { ...AuthMethodCommand.baseFlags, ...environmentFlags };
  static override flags = {
    provider: Flags.string({
      options: [...IDP_PROVIDERS, CUSTOM_PROVIDER],
      description: `Identity provider to enable, or "${CUSTOM_PROVIDER}" for a custom OpenID Connect (OIDC) provider.`,
    }),
    slug: settingFlag("--slug", (value) => {
      return parseConnectionSlug(value, RESERVED_SLUGS);
    })({
      description: "Name of the custom connection. Schemas and flows refer to it by this.",
    }),
    "display-name": settingFlag(
      "--display-name",
      parseDisplayName,
    )({
      description: "Name shown on the custom connection's sign-in button.",
    }),
    issuer: settingFlag(
      "--issuer",
      parseIssuer,
    )({
      description: "Issuer URL of the custom provider. Its endpoints are found by OIDC discovery.",
    }),
    scopes: settingFlag(
      "--scopes",
      parseScopes,
    )({
      description:
        "Scopes the custom connection requests, separated by spaces or commas. Must include openid. Default: openid profile email.",
    }),
    "client-id": Flags.custom<ClientId>({
      parse: reads(CLIENT_ID),
    })({
      description: "Client id of the application registered with the provider.",
    }),
  };

  static override meta = {
    resolveServer: true,
    environment: true,
  };

  protected async execute({ flags }: Admitted<typeof AuthMethodSsoEnable>): Promise<JsonEnvelope> {
    if (flags.provider === undefined) {
      throw refusalError(PROVIDER_IS_NAMED_REFUSAL, {});
    }
    const project = ssoProvider(flags, {
      interactive: !this.nonInteractive && !this.dryRun,
    });
    const issuer = await developmentIssuer(this.cwd, flags, this.env);
    const target = await this.schemaTarget(flags);
    const flows = ssoFlows(target);
    const connections = await readConnectionFiles(target.cwd);
    // Resolved before anything else is asked for: being turned away after
    // typing a secret would mean typing it again.
    const { client, projectId, server } = await this.connect();
    // The schema and flow edits for a slug, with the refusals they bring (an
    // edit the editors cannot make, or a flow `deploy` would then reject), so
    // the run stops with nothing changed (ADR 070 §3).
    const editsFor = (slug: ConnectionSlug): PlannedEdits => {
      const edits = planEdits(target.schema, slug, flows);
      refuseBrokenFlows(
        target.schema,
        edits.schema.document as Record<string, unknown>,
        edits.flows.map(({ flow, result }) => ({
          file: flow,
          after: result.document as Record<string, unknown>,
        })),
      );
      return edits;
    };
    // A custom provider's settings are asked here, after the checks on the
    // Project; the ones that need an answer run the moment the answer that
    // decides them is given (see `askCustomSettings`).
    const selection =
      project.selection ??
      selectionFromFlags(
        CUSTOM_PROVIDER,
        await this.askCustomSettings(project.values, connections, (slug) => {
          editsFor(slug);
        }),
        ENABLE_FLAG_NAMES,
        customExample(ENABLE_FLAG_NAMES),
      );
    const entry = providerOf(selection);
    // A loopback issuer works only on a server that may fetch from this machine.
    const loopback = loopbackIssuerWarning(selection, await loopbackReach(target.cwd, server));
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

    const plan = planConnection({
      selection,
      files: connections,
      clientId: flags.clientId,
      scopesGiven: flags.scopes !== undefined,
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

    // Worked out before the dry-run return and before the connection is
    // written or a credential published.
    const edits = editsFor(plan.slug);
    const outcome = {
      schema: target.schema,
      before: target.schema.body,
      after: edits.schema.document as Record<string, unknown>,
      flowsAfter: edits.flows.map(({ result }) => result.document as Record<string, unknown>),
    };

    // Which project this ran against is the summary's last line, not a label
    // printed before the first question: `connect()` above already recorded it.
    // The schema is this command's own subject, so it stays as narration.
    consola.info(
      `Editing ${target.schema.path}${target.schema.methods.length > 0 ? `, which offers ${target.schema.methods.join(", ")}` : ""}`,
    );

    // Before the dry-run return, so a preview is enough to register the client.
    // Shown on reuse too: the URI moved to one per connection after the first
    // release, and rerunning this command is how a developer finds the one to
    // register now.
    const registration = reusing
      ? [`Callback URI   ${callbackUri}`]
      : [
          `${entry.displayName} needs an OAuth application.`,
          `Callback URI   ${callbackUri}`,
          // A custom provider has no console to send the developer to: it is
          // theirs, and the issuer they gave is the only address known.
          entry.consoleUrl === undefined
            ? `Register it as a client at ${entry.issuer}, with the callback URI above.`
            : `Create it at   ${entry.consoleUrl}`,
        ];
    for (const line of registration) {
      consola.info(line);
    }

    // Hand-edited regions the edits leave alone, said on a dry run before
    // anything is written and on a real run after.
    const reportUntouched = (verb: "Would leave" | "Left") => {
      for (const skipped of edits.skipped) {
        const toDo =
          skipped.step === "password"
            ? `Add ${plan.slug} to its sso_providers, and route sso_authenticated to the step a sign-in ends on, sso_user_not_found to register-sso and user_already_exists to sso-conflict.`
            : skipped.step === "sso-conflict"
              ? `Add ${plan.slug} to its sso_providers.`
              : "Update it yourself.";
        reportWarning(`${verb} ${skipped.region} alone: it has been edited by hand. ${toDo}`);
      }
    };

    if (this.dryRun) {
      reportUntouched("Would leave");
      // Nothing is asked or read: a reuse publishes only the credentials it is
      // given, and a dry run reads no piped secret, so none is listed.
      const changed = editedFiles(target.schema, edits);
      const toStore = reusing
        ? flags.clientId !== undefined && idVariable !== undefined
          ? [idVariable]
          : []
        : [scaffolded.clientId, scaffolded.clientSecret];
      this.reportOutcome(outcome);
      const said = [
        `Would ${plan.action} ${plan.action === "reuse" ? plan.file.path : plan.path}`,
        ...changed.map((file) => `Would update ${file}`),
        ...(toStore.length > 0 ? [`Would store ${toStore.join(" and ")} on the project`] : []),
      ];

      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: {
          ...this.payload({
            projectId,
            provider,
            schema: target.schema.name,
            plan,
            callbackUri,
            secret: undefined,
            clientId: undefined,
            idVariable,
            changed,
            skipped: edits.skipped,
          }),
          would_store: toStore,
        },
        // The ending closes on the first line and lists the others under it.
        summary: {
          title: escapeControlCharacters(said[0] ?? ""),
          sections: [],
          lines: said.slice(1).map((line) => escapeControlCharacters(line)),
        },
      });
    }
    // An existing connection is reused rather than rewritten, but the schema
    // and flow edits still run: those are the point of the command, they are
    // per-schema, and they are idempotent. Enabling the provider for a second
    // user type, and finishing a run interrupted after the connection file was
    // written, both arrive here.
    // Both are set inside whichever branch runs below, between statements that
    // print and prompt, so neither can be built as one expression.
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
      if (flags.clientId !== undefined) {
        if (idVariable === undefined) {
          reportWarning(
            `${plan.file.path} holds its client id directly, so nothing was published. ` +
              "Edit the file to change it.",
          );
        } else {
          clientIdState = await publishClientId({
            name: idVariable,
            value: flags.clientId,
            publish,
          });
        }
      }
      // Reuse never demands a secret: the project may already hold it, and
      // refusing an unattended rerun for a credential that has not changed
      // would be noise. It is only read so that a rerun can replace it.
      const piped = await this.ask.secret({
        name: "client secret",
        message: `What is the client secret of your ${entry.displayName} OAuth app?`,
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
              developmentBuild: isDevelopmentBuild() && !this.nonInteractive,
              ask: this.ask,
            })
          : undefined;
      const clientId = await this.ask.text({
        name: `client id for ${entry.displayName}`,
        message: `What is the client ID of your ${entry.displayName} OAuth app?`,
        flag: "--client-id",
        parse: parseClientId,
        given: flags.clientId,
        retry: retryFor("<client-id>"),
      });
      // Required, like the client id. The connection document references the
      // secret as `${{ NAME }}` and the engine resolves that from the project's
      // variables, so enabling a provider without one writes a sign-in button
      // that fails at the token endpoint with `invalid_client` -- a failure
      // that surfaces in a browser, not here. Refusing now is the cheaper answer.
      const secretValue = await this.ask.secret({
        name: `client secret for ${scaffolded.clientSecret}`,
        message: `What is the client secret of your ${entry.displayName} OAuth app? It will be stored on the project as ${scaffolded.clientSecret}.`,
        parse: parseClientSecret,
        stdin: true,
        retry: retryFor(clientId, `printf '%s' "$CLIENT_SECRET" | `),
      });

      const publish = this.publisher(client, projectId);
      const connection = entry.connection({
        slug: plan.slug,
        schemaProperties: target.schema.properties,
        schemaRef: CONNECTION_SCHEMA_REF,
        endpoints,
      });
      // A connection is scaffolded with the properties the provider maps by
      // default, narrowed to what the schema defines. A schema that defines none
      // of them leaves it with no mapping, and `deploy` refuses a connection that
      // fills nothing, so say so now and not on the next command.
      if (!("claim_mapping" in connection)) {
        reportWarning(
          `${target.schema.path} defines none of the properties ${entry.displayName} maps by default, so ${plan.path} has no claim_mapping ` +
            `and no sign-in can fill a user. Add the properties your provider returns to claim_mapping in ${plan.path}.`,
        );
      }
      if (endpoints?.issuer !== undefined && endpoints.issuer !== entry.issuer) {
        // Said out loud: a connection pointing somewhere other than the
        // vendor is not what the developer will want in the end, and nothing
        // else in the output would show it.
        reportWarning(`${entry.displayName} points at ${endpoints.issuer}, not the provider`);
      }
      const connectionFile = join(target.cwd, plan.path);
      await mkdir(dirname(connectionFile), { recursive: true });
      // `wx` rather than a plain write: planConnection decided this file does
      // not exist, and anything that appeared since is not ours to overwrite.
      await writeFile(connectionFile, `${stableStringify(connection)}\n`, { flag: "wx" });
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
      if (selection.kind === "custom") {
        for (const note of mappingNotes({
          file: plan.path,
          provider: entry.displayName,
          connection,
        })) {
          consola.info(note);
        }
      }
    }

    const written = await this.enableInConfiguration(target.cwd, target.schema, edits);

    for (const file of written) {
      consola.success(`Updated ${file}`);
    }
    reportUntouched("Left");
    if (written.length === 0 && edits.skipped.length === 0) {
      consola.info(`${target.schema.name} and its login flow already offer ${entry.displayName}`);
    }
    if (clientIdState !== undefined && idVariable !== undefined) {
      reportClientIdOutcome(idVariable, clientIdState, this.cliVersion, this.environmentSelector());
    }
    if (secret) {
      // A reuse that piped nothing in had no value to publish; a create always
      // has one, because the command refuses without it.
      reportSecretOutcome(secret, this.cliVersion, reusing, this.environmentSelector());
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
    const stored = credentialsStored ? ["and its credentials are stored in your project"] : [];
    const name = entry.displayName;
    const followUps = this.followUps(unpublished, scopeArgs, recovery);

    const title = unpublished
      ? [`${name} sign-in is configured locally`, ...stored].join(" ")
      : `${name} sign-in is already configured locally`;

    return this.emit({
      status: "ok",
      boxed: true,
      data: {
        title,
        ...this.payload({
          projectId,
          provider,
          schema: target.schema.name,
          plan,
          callbackUri,
          secret,
          clientId: clientIdState,
          idVariable,
          changed: written,
          skipped: edits.skipped,
        }),
        next_args: followUps.args,
      },
      next: {
        ...(unpublished
          ? {
              actions: [
                `Deploy it to make ${name} sign-in available in your app, then reload the app and test it: ${this.suggest(DEPLOY_ARGS)}`,
              ],
            }
          : {}),
        commands: followUps.commands,
      },
      summary: {
        title: escapeControlCharacters(
          unpublished
            ? `${name} sign-in is configured locally`
            : `${name} sign-in is already configured locally`,
        ),
        sections: [],
        // The headline stays one line; what else it would have said goes under it.
        lines:
          unpublished && credentialsStored ? ["Its credentials are stored in your project."] : [],
        // The deploy is a step with its command on a line of its own, so it can
        // be copied; the envelope's action carries it inline, as a script reads it.
        next: [
          ...(unpublished
            ? [
                {
                  text: `Deploy it to make ${name} sign-in available in your app, then reload the app and test it:`,
                  command: this.suggest(DEPLOY_ARGS),
                },
              ]
            : []),
          ...(followUps.commands.length === 0
            ? []
            : [{ text: "Run next:", command: followUps.commands.join("\n") }]),
        ],
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
    const variableService = new VariableService(client, projectId);
    return async (name, value, { secret }) => {
      await variableService.set(
        name,
        value,
        VariableWrite.of({
          secret,
          preview: false,
        }),
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
   * The settings of a custom connection, asking only for the ones not already
   * given, in the order that lets each answer decide what comes next. The slug
   * comes first because it decides the most: it names the file the connection
   * is kept in, so everything that depends on the slug alone is checked the
   * moment it is typed (`checkCustomSlug`, then `beforeAsking`), and a connection that already exists
   * answers the rest from its file. A given value goes through the same parser
   * as a typed one, and the ones given on the command line were checked under
   * their own flag on the way in.
   *
   * @param beforeAsking - Raises whatever else is known once the slug is.
   */
  private async askCustomSettings(
    given: CustomFlagValues,
    files: readonly ConnectionFile[],
    beforeAsking: (slug: ConnectionSlug) => void,
  ): Promise<Required<CustomFlagValues>> {
    const slug = await this.ask.text({
      name: "connection name",
      message:
        "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
      parse: (value) => parseConnectionSlug(value, RESERVED_SLUGS),
      given: given.slug,
    });
    const existing = checkCustomSlug(files, slug, ENABLE_FLAG_NAMES.slug);
    beforeAsking(slug);
    // An existing connection is described by its file, so nothing it already
    // holds is asked again; reuse never applies scopes, so they are not asked.
    const stored = existing === undefined ? undefined : usableStoredSettings(existing, slug, given);
    // An issuer given as a flag must be the one the connection was written with:
    // that is known now, not after the next answer.
    const givenIssuer = given.issuer === undefined ? undefined : parseIssuer(given.issuer);
    if (existing !== undefined && givenIssuer?.ok) {
      refuseChangedIssuer(existing, slug, givenIssuer.value, ENABLE_FLAG_NAMES.slug);
    }
    const displayName = await this.ask.text({
      name: "display name",
      message: "What name should the sign-in button show? For example Acme SSO.",
      parse: parseDisplayName,
      given: given.displayName ?? stored?.displayName,
    });
    const issuer = await this.ask.text({
      name: "issuer",
      message: "What is the issuer URL of the provider?",
      parse: parseIssuer,
      given: given.issuer ?? stored?.issuer,
    });
    const scopes = await this.ask.text({
      name: "scopes",
      message: "Which scopes should we request? Separate them with spaces.",
      parse: parseScopes,
      given: given.scopes ?? (existing === undefined ? undefined : DEFAULT_SCOPES.join(" ")),
      initialValue: DEFAULT_SCOPES.join(" "),
    });
    return { slug, displayName, issuer, scopes: scopes.join(" ") };
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

/**
 * What the file of an existing custom connection holds, checked as a typed
 * answer is, or a refusal that names the file and the setting: a stored value
 * that cannot be used would otherwise surface as an error about a flag the
 * person never passed. A file with no issuer is not an OIDC connection to
 * reuse at all, whatever issuer is typed.
 */
function usableStoredSettings(
  file: ConnectionFile,
  slug: ConnectionSlug,
  given: CustomFlagValues,
): CustomFlagValues {
  const stored = storedCustomSettings(file);
  if (stored.issuer === undefined) {
    throw new ZitadelError(
      "E_CONFLICT",
      `${file.path} is already named ${slug} and is not an OIDC connection`,
      {
        hint: `Fix the file, or choose another ${ENABLE_FLAG_NAMES.slug}, then run the command again.`,
        details: { file: file.path, slug },
      },
    );
  }
  // Only a stored value that will be used is held to the rules: one a flag
  // replaces is not read at all.
  const usable = <T>(
    what: string,
    value: string | undefined,
    flag: string | undefined,
    parse: (v: string) => Parsed<T>,
  ) => {
    const parsed = flag !== undefined || value === undefined ? undefined : parse(value);
    if (parsed !== undefined && !parsed.ok) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${file.path} holds ${what} that cannot be used: ${parsed.problem}`,
        {
          hint: `Fix it in that file, or choose another ${ENABLE_FLAG_NAMES.slug}.`,
          details: { file: file.path, slug },
        },
      );
    }
    return flag === undefined ? value : undefined;
  };
  return {
    displayName: usable("a display name", stored.displayName, given.displayName, parseDisplayName),
    issuer: usable("an issuer", stored.issuer, given.issuer, parseIssuer),
  };
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

/**
 * What a person needs to know about the claim mappings a custom connection was
 * written with, in two parts: the mappings (where they are, which side of each
 * line is their user schema's and which is the claim the provider must return),
 * then what verifies a value, which a mapping alone does not. Nothing here
 * edits a mapping; the connection file is where that happens.
 */
function mappingNotes(options: { file: string; provider: string; connection: object }): string[] {
  const { file, provider, connection } = options;
  const document = connection as {
    claim_mapping?: Readonly<Record<string, string>>;
    verified_claims?: Readonly<Record<string, string | true>>;
  };
  const mappings = Object.entries(document.claim_mapping ?? {});
  if (mappings.length === 0) {
    return [];
  }
  const verified = Object.entries(document.verified_claims ?? {});
  return [
    `Claim mappings in ${file}. Each line is an attribute of your user schema, then the claim ${provider} must return for it:`,
    ...mappings.map(([attribute, claim]) => `  ${attribute} ← ${claim}`),
    ...(verified.length === 0
      ? ["Nothing is treated as verified."]
      : [
          "Verification, which a mapping alone does not give:",
          ...verified.map(([attribute, how]) =>
            how === true
              ? `  ${attribute} is treated as verified.`
              : `  ${attribute} is treated as verified only when ${provider} says so in the ${how} claim.`,
          ),
        ]),
    "Edit the mappings in that file if your provider returns other claims.",
  ];
}
