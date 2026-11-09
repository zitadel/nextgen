import { Flags } from "@oclif/core";
import {
  type ClientId,
  type ClientSecret,
  type ConnectionEndpoints,
  type ConnectionSlug,
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
import { consola } from "consola";
import { z } from "zod";

import { AuthMethodCommand, type SchemaTarget } from "@/commands/auth-method/command";
import { VariableService, VariableWrite, type ZitadelClient } from "@/lib/backend";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { resolveEnvironment } from "@/lib/environment";
import { ZitadelError } from "@/lib/errors";
import {
  askConnectionEndpoints,
  callbackUriFor,
  type CustomFlagValues,
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  loopbackIssuerWarning,
  publishClientId,
  type PublishState,
  reportClientIdOutcome,
  reportSecretOutcome,
  republishArgs,
  type SecretOutcome,
  type SecretPublisher,
  selectionFromFlags,
  storeClientSecret,
} from "@/lib/idp";
import { loopbackReach } from "@/lib/local-server/runtime";
import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { environmentFlags } from "@/lib/oclif/environment-flags";
import { filled, reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { prose } from "@/lib/oclif/rendering";
import { inShell, type SuggestedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import {
  type Change,
  Connection,
  type ConnectionSetting,
  type CredentialNames,
} from "@/lib/zitadel";

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
      : selectionFromFlags(provider, values, ENABLE_FLAG_NAMES, customExample(ENABLE_FLAG_NAMES)),
    values,
  };
}

/** What a Project with no development issuer is refused for. */
const NO_ISSUER_REFUSAL: Refusal = {
  message: "This Project has no development issuer",
  hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
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
    const { config, schema } = target;
    // Refused before anything is asked: a provider no flow offers is no
    // sign-in button however well everything else goes.
    config.ssoFlows(schema);
    // Resolved before anything else is asked for: being turned away after
    // typing a secret would mean typing it again.
    const { client, projectId, server } = await this.connect({ quiet: true });
    const selection =
      project.selection ??
      selectionFromFlags(
        CUSTOM_PROVIDER,
        await this.askCustomSettings(target, project.values),
        ENABLE_FLAG_NAMES,
        customExample(ENABLE_FLAG_NAMES),
      );
    const provider = providerOf(selection);
    const options = {
      clientId: flags.clientId,
      given: givenSettings(selection, flags.scopes !== undefined),
    };
    // Worked out before anything is asked or written, so every refusal comes
    // first: a connection that would step on another, a region the edits cannot
    // write, or a flow `deploy` would then reject (ADR 070 §3).
    const candidate = Connection.forProvider(provider, schema);
    const existing = config.existingConnection(candidate, options);
    const connection = existing ?? candidate;
    const preview = config.enableSso(schema, candidate, options);

    // A loopback issuer works only on a server that may fetch from this machine.
    const loopback = loopbackIssuerWarning(selection, await loopbackReach(target.cwd, server));
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    // The connection's own route, so its slug decides it: a reused connection
    // keeps the slug it was created with.
    const callbackUri = callbackUriFor(issuer, connection.name);
    const names = connection.credentialNames;
    consola.info(`Project   ${escapeControlCharacters(projectId)}`);
    if (schema.methods.length > 0) {
      consola.info(`Schema    ${schema.path} (${schema.methods.join(", ")})`);
    } else {
      consola.info(`Schema    ${schema.path}`);
    }
    // Before the dry-run return, so a preview is enough to register the
    // client. Shown on reuse too: rerunning this command is how a developer
    // finds the callback URI to register.
    if (existing === undefined) {
      consola.info(`${provider.displayName} needs an OAuth application.`);
    }
    consola.info(`Callback URI   ${callbackUri}`);
    // A custom provider has no console to send the developer to: it is
    // theirs, and the issuer they gave is the only address known.
    if (existing === undefined && provider.consoleUrl === undefined) {
      consola.info(`Register it as a client at ${provider.issuer}, with the callback URI above.`);
    }
    if (existing === undefined && provider.consoleUrl !== undefined) {
      consola.info(`Create it at   ${provider.consoleUrl}`);
    }

    const summary = {
      projectId,
      provider: selectionName(selection),
      schema: schema.name,
      connection,
      reused: existing !== undefined,
      callbackUri,
    };
    if (this.dryRun) {
      this.report(preview);
      // Nothing is asked or read: a reuse publishes only the credentials it is
      // given, and a dry run reads no piped secret, so none is listed.
      const reusedId =
        flags.clientId !== undefined && names.clientId !== undefined ? [names.clientId] : [];
      const toStore = existing === undefined ? [names.clientId, names.clientSecret] : reusedId;
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: {
          ...this.payload({
            ...summary,
            change: preview,
            clientId: undefined,
            secret: undefined,
            names,
          }),
          would_store: toStore,
        },
        pretty: prose(
          [
            ...preview.changedPaths.map((file) => {
              return `Would write ${file}`;
            }),
            ...(toStore.length > 0 ? [`Would store ${toStore.join(" and ")} on the project`] : []),
          ].join("\n"),
        ),
      });
    }

    const credentials = await this.askCredentials({
      selection,
      existing,
      givenClientId: flags.clientId,
      names,
    });
    // The endpoints a development run answered for change only a new
    // connection's body, never which files the change writes.
    const change =
      credentials.endpoints === undefined
        ? preview
        : config.enableSso(
            schema,
            Connection.forProvider(provider, schema, credentials.endpoints),
            options,
          );
    if (existing !== undefined) {
      consola.success(`Reusing ${existing.path}`);
    }
    const written = await this.write(target, change);
    const published = await this.publish({
      publish: this.publisher(client, projectId),
      connection,
      names,
      credentials,
    });
    this.report(change);
    if (
      credentials.endpoints?.issuer !== undefined &&
      credentials.endpoints.issuer !== provider.issuer
    ) {
      // A connection pointing somewhere other than the vendor is not what the
      // developer will want in the end, and nothing else would show it.
      reportWarning(
        `${provider.displayName} points at ${credentials.endpoints.issuer}, not the provider`,
      );
    }
    if (written.length === 0 && change.notices.length === 0) {
      consola.info(`${schema.name} and its login flow already offer ${provider.displayName}`);
    }

    // `variable set` first, for a credential that did not reach the project:
    // the connection references it as `${{ NAME }}`, so a button whose
    // credential never arrived fails at token exchange. Then deploy, when a
    // file changed. All carry --cwd and the run's environment.
    const scopeArgs = this.environmentSelectorArgs();
    const recovery = republishArgs(
      [
        { name: names.clientId, secret: false, published: published.clientId },
        { name: names.clientSecret, secret: true, published: published.secret?.published },
      ],
      scopeArgs,
    );
    const unpublished = existing === undefined || written.length > 0;
    const stored =
      published.secret?.published === "stored" &&
      published.clientId !== "deferred" &&
      published.clientId !== "failed";
    const name = provider.displayName;
    const followUps = this.followUps(unpublished, scopeArgs, recovery);
    const title = unpublished
      ? `${name} sign-in is configured locally.`
      : `${name} sign-in is already configured locally.`;
    const actions = [
      `Deploy the configuration to make ${name} sign-in available in your app, then reload your app and test ${name} sign-in.`,
    ];

    return this.emit({
      status: "ok",
      data: {
        title:
          stored && unpublished
            ? `${title} Provider credentials are stored on your Project.`
            : title,
        ...this.payload({
          ...summary,
          change,
          clientId: published.clientId,
          secret: published.secret,
          names,
        }),
        next_args: followUps.args,
      },
      next: { ...(unpublished ? { actions } : {}), commands: followUps.commands },
    });
  }

  /**
   * The credentials the connection needs, asked for once nothing is left that
   * could refuse the run. A new connection needs both: a sign-in button without
   * them fails at the provider, in a browser, not here. A reused one is given
   * only what the developer passes: the project may already hold its
   * credentials, and an unattended rerun should not start asking for them.
   */
  private async askCredentials(input: {
    selection: ProviderSelection;
    existing: Connection | undefined;
    givenClientId: ClientId | undefined;
    names: CredentialNames;
  }): Promise<Credentials> {
    const provider = providerOf(input.selection);
    if (input.existing !== undefined) {
      // Only read so that a rerun can replace a secret the project holds.
      const secret = await this.input({
        kind: "secret",
        name: "client secret",
        message: `What is the client secret of your ${provider.displayName} OAuth app?`,
        parse: parseClientSecret,
        stdin: true,
        optional: true,
      });
      return { endpoints: undefined, clientId: input.givenClientId, secret };
    }
    // Before the credentials: on a development run (ZITADEL_CLI_DEV) the
    // provider may be a local stand-in, and the client is registered with
    // whatever answers. Not asked of a custom connection, whose issuer the
    // developer has already given.
    const endpoints =
      input.selection.kind === "catalog"
        ? await askConnectionEndpoints({
            provider: input.selection.id,
            developmentBuild: isDevelopmentBuild() && !this.nonInteractive,
            ask: this.input,
          })
        : undefined;
    const clientId = await this.input({
      kind: "text",
      name: `client id for ${provider.displayName}`,
      message: `What is the client ID of your ${provider.displayName} OAuth app?`,
      flag: "--client-id",
      parse: parseClientId,
      given: input.givenClientId,
      retry: this.retryFor(input.selection, "<client-id>"),
    });
    const secret = await this.input({
      kind: "secret",
      name: `client secret for ${input.names.clientSecret}`,
      message: `What is the client secret of your ${provider.displayName} OAuth app? It will be stored on the project as ${input.names.clientSecret}.`,
      parse: parseClientSecret,
      stdin: true,
      retry: this.retryFor(input.selection, clientId, `printf '%s' "$CLIENT_SECRET" | `),
    });
    return { endpoints, clientId, secret };
  }

  /**
   * What an agent can run once a missing credential is to hand. Only for a
   * catalog provider: a custom connection needs its settings repeated too.
   */
  private retryFor(
    selection: ProviderSelection,
    clientId: string,
    pipe = "",
  ): SuggestedCommand | undefined {
    if (selection.kind !== "catalog") {
      return undefined;
    }
    const command = this.suggest(
      `auth-method sso enable --provider ${selectionName(selection)} --client-id ${clientId}`,
    );
    return inShell(command, { before: pipe });
  }

  /**
   * Store the credentials the developer gave in the project variables the
   * connection reads them from, the client id first: it is the half the
   * developer can read back afterwards. A credential the connection holds as a
   * value has no variable to go to, which is said instead.
   */
  private async publish(input: {
    publish: SecretPublisher | undefined;
    connection: Connection;
    names: CredentialNames;
    credentials: Credentials;
  }): Promise<Published> {
    const { publish, connection, names, credentials } = input;
    const selector = this.environmentSelector();
    const reused = connection.status === "read";
    if (credentials.clientId !== undefined && names.clientId === undefined) {
      reportWarning(
        `${connection.path} holds its client id directly, so nothing was published. Edit the file to change it.`,
      );
    }
    if (credentials.secret !== undefined && names.clientSecret === undefined) {
      reportWarning(
        `${connection.path} holds its client secret directly, so nothing was published. ` +
          "Replace it with a ${{ NAME }} reference so the secret is not committed.",
      );
    }
    const clientId =
      credentials.clientId === undefined || names.clientId === undefined
        ? undefined
        : await publishClientId({ name: names.clientId, value: credentials.clientId, publish });
    const secret =
      credentials.secret === undefined || names.clientSecret === undefined
        ? undefined
        : await storeClientSecret({ name: names.clientSecret, value: credentials.secret, publish });
    if (clientId !== undefined && names.clientId !== undefined) {
      reportClientIdOutcome(names.clientId, clientId, this.cliVersion, selector);
    }
    if (secret !== undefined) {
      reportSecretOutcome(secret, this.cliVersion, reused, selector);
    }
    return { clientId, secret };
  }

  /**
   * How the connection's credentials reach the project, or `undefined` when
   * there is no project behind this run: `--source mock` answers from fixtures
   * and has no variables to write. It writes to the project's own variables,
   * which is where the engine resolves a connection's `${{ NAME }}` references
   * from.
   */
  private publisher(client: ZitadelClient, projectId: string): SecretPublisher | undefined {
    if (this.meta.source === "mock") {
      return undefined;
    }
    const variableService = new VariableService(client, projectId);
    return async (name, value, { secret }) => {
      await variableService.set(name, value, VariableWrite.of({ secret, preview: false }));
    };
  }

  /**
   * The settings of a custom connection, asking only for the ones not already
   * given. The slug comes first because it decides the most: a connection that
   * already has it answers the rest from its file, and one that connects to
   * another issuer is refused the moment the slug is typed. A given value goes
   * through the same parser as a typed one.
   */
  private async askCustomSettings(
    target: SchemaTarget,
    given: CustomFlagValues,
  ): Promise<Required<CustomFlagValues>> {
    const slug = await this.input({
      kind: "text",
      name: "connection name",
      message:
        "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
      parse: (value) => {
        return parseConnectionSlug(value, RESERVED_SLUGS);
      },
      given: given.slug,
    });
    const givenIssuer = given.issuer === undefined ? undefined : parseIssuer(given.issuer);
    const existing = target.config.connectionNamed(
      slug,
      givenIssuer?.ok ? givenIssuer.value : undefined,
    );
    // An existing connection is described by its file, so nothing it already
    // holds is asked again; reuse never applies scopes, so they are not asked.
    const stored = existing === undefined ? undefined : usableStoredSettings(existing, slug, given);
    const displayName = await this.input({
      kind: "text",
      name: "display name",
      message: "What name should the sign-in button show? For example Acme SSO.",
      parse: parseDisplayName,
      given: given.displayName ?? stored?.displayName,
    });
    const issuer = await this.input({
      kind: "text",
      name: "issuer",
      message: "What is the issuer URL of the provider?",
      parse: parseIssuer,
      given: given.issuer ?? stored?.issuer,
    });
    const scopes = await this.input({
      kind: "text",
      name: "scopes",
      message: "Which scopes should we request? Separate them with spaces.",
      parse: parseScopes,
      given: given.scopes ?? (existing === undefined ? undefined : DEFAULT_SCOPES.join(" ")),
      initialValue: DEFAULT_SCOPES.join(" "),
    });
    return { slug, displayName, issuer, scopes: scopes.join(" ") };
  }

  /** The machine-readable result. Never the secret, only whether it is held. */
  private payload(input: {
    /**
     * The Project the run addresses. `--json` suppresses the console line that
     * otherwise carries it, and a result that names only the schema does not
     * say which Project was changed.
     */
    projectId: string;
    provider: ProviderName;
    schema: string;
    connection: Connection;
    reused: boolean;
    callbackUri: string;
    change: Change;
    clientId: PublishState | undefined;
    secret: SecretOutcome | undefined;
    names: CredentialNames;
  }): Record<string, unknown> {
    const { clientId, secret, names } = input;
    return {
      project_id: input.projectId,
      provider: input.provider,
      schema: input.schema,
      connection: {
        action: input.reused ? "reuse" : "create",
        slug: input.connection.name,
        file: input.connection.path,
      },
      callback_uri: input.callbackUri,
      changed: [...input.change.changedPaths],
      notices: input.change.notices,
      client_id:
        clientId === undefined || names.clientId === undefined
          ? null
          : { variable: names.clientId, published: clientId },
      secret: secret === undefined ? null : { variable: secret.name, published: secret.published },
    };
  }
}

/** The credentials a run was given or asked for. */
type Credentials = Readonly<{
  endpoints: ConnectionEndpoints | undefined;
  clientId: ClientId | undefined;
  secret: ClientSecret | undefined;
}>;

/** What became of each credential sent to the project. */
type Published = Readonly<{
  clientId: PublishState | undefined;
  secret: SecretOutcome | undefined;
}>;

/**
 * The connection settings the developer gave, which an existing connection
 * may not have: a custom connection's display name, and its scopes when
 * `--scopes` was passed. A catalog provider's settings are the catalog's.
 */
function givenSettings(
  selection: ProviderSelection,
  scopesGiven: boolean,
): readonly ConnectionSetting[] {
  if (selection.kind === "catalog") {
    return [];
  }
  if (scopesGiven) {
    return ["display name", "scopes"];
  }
  return ["display name"];
}

/**
 * What the file of an existing custom connection holds, checked as a typed
 * answer is, or a refusal that names the file and the setting: a stored value
 * that cannot be used would otherwise surface as an error about a flag the
 * person never passed. A file with no issuer is not an OIDC connection to
 * reuse at all, whatever issuer is typed.
 */
function usableStoredSettings(
  connection: Connection,
  slug: ConnectionSlug,
  given: CustomFlagValues,
): CustomFlagValues {
  if (connection.issuer === undefined) {
    throw new ZitadelError(
      "E_CONFLICT",
      `${connection.path} is already named ${slug} and is not an OIDC connection`,
      {
        hint: `Fix the file, or choose another ${ENABLE_FLAG_NAMES.slug}, then run the command again.`,
        details: { file: connection.path, slug },
      },
    );
  }
  return {
    displayName: storedSetting(
      connection,
      slug,
      "a display name",
      connection.displayName,
      given.displayName,
      parseDisplayName,
    ),
    issuer: storedSetting(
      connection,
      slug,
      "an issuer",
      connection.issuer,
      given.issuer,
      parseIssuer,
    ),
  };
}

/**
 * One stored setting, when it will be used: one a flag replaces is not read at
 * all, and one that is used is held to the same rules as a typed answer.
 */
function storedSetting<T>(
  connection: Connection,
  slug: ConnectionSlug,
  what: string,
  value: string | undefined,
  flag: string | undefined,
  parse: (value: string) => Parsed<T>,
): string | undefined {
  if (flag !== undefined || value === undefined) {
    return undefined;
  }
  const parsed = parse(value);
  if (!parsed.ok) {
    throw new ZitadelError(
      "E_VALIDATION",
      `${connection.path} holds ${what} that cannot be used: ${parsed.problem}`,
      {
        hint: `Fix it in that file, or choose another ${ENABLE_FLAG_NAMES.slug}.`,
        details: { file: connection.path, slug },
      },
    );
  }
  return value;
}
