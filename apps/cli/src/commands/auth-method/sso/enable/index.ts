import { Flags } from "@oclif/core";
import {
  type ClientId,
  type ClientIdVariable,
  type ClientSecret,
  type ClientSecretVariable,
  type ConnectionEndpoints,
  CUSTOM_PROVIDER,
  credentialVariables,
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
  type Credential,
  type DocumentChange,
} from "@/lib/zitadel";

/**
 * The provider the run was asked for.
 *
 * @remarks
 * `selection` is undefined for a custom provider whose settings a person will
 * be asked for once everything that can fail has passed; `values` are the
 * settings the flags gave. A person at a terminal is asked for the settings
 * they left out, but later: here the ones they did give are only checked. A
 * script, a dry run or `--non-interactive` is held to the flags and told which
 * are missing.
 */
type SsoProvider = {
  readonly selection: ProviderSelection | undefined;
  readonly values: CustomFlagValues;
};

/**
 * The provider and custom-connection flags, by the names they are read as.
 */
type ProviderFlags = {
  readonly [K in (typeof ENABLE_FLAG_KEYS)[keyof typeof ENABLE_FLAG_KEYS]]?: string;
};

/**
 * Whether a person is there to ask for the settings left out.
 */
type SsoRun = {
  readonly interactive: boolean;
};

/**
 * The flags that pick the environment a run reads its issuer from.
 */
type EnvironmentFlags = {
  readonly server?: string | undefined;
  readonly env?: string | undefined;
  readonly envFile?: string | undefined;
};

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
 * the platform's own parser found wrong with it.
 *
 * @remarks
 * The flag names itself in the refusal, because a run gives four of them and
 * the complaint belongs to one. `setup` declares the same settings under its
 * own `--sso-*` names.
 *
 * @param flag - The flag, as the command spells it.
 * @param parse - The platform's parser for the setting.
 * @returns The flag's definition, waiting for its description.
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

/**
 * What the flags say about the provider to add.
 *
 * @param flags - The provider and custom-connection flags the run was given.
 * @param run - Whether someone is there to ask for the settings left out.
 * @returns The provider, or only the given settings when a person will be
 *   asked for the rest.
 * @throws {@link ZitadelError} When a script, a dry run or `--non-interactive`
 *   leaves out a custom connection's setting.
 */
export function ssoProvider(flags: ProviderFlags, run: SsoRun): SsoProvider {
  const provider = String(flags.provider);
  const values = customFlagValues(flags, ENABLE_FLAG_KEYS);
  // Each setting was refused under its own flag on its way in, so a run that
  // will ask for the rest has nothing left to check: the settings that were
  // given are already good, and being turned away after typing a secret would
  // mean typing it again.
  const complete =
    values.slug !== undefined && values.displayName !== undefined && values.issuer !== undefined;
  const askLater = provider === CUSTOM_PROVIDER && run.interactive && !complete;
  if (askLater) {
    return { selection: undefined, values };
  }
  const example = customExample(ENABLE_FLAG_NAMES);
  return { selection: selectionFromFlags(provider, values, ENABLE_FLAG_NAMES, example), values };
}

/**
 * What a Project with no development issuer is refused for.
 */
const NO_ISSUER_REFUSAL: Refusal = {
  message: "This Project has no development issuer",
  hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
};

/**
 * The origin the app serves from, as the run's environment names it.
 *
 * @param cwd - The project root.
 * @param flags - The flags that pick the environment.
 * @param env - The process environment.
 * @returns The issuer.
 * @throws {@link ZitadelError} When the Project has none, so it has not been set up.
 */
export async function developmentIssuer(
  cwd: string,
  flags: EnvironmentFlags,
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
 * The credentials a run was given or asked for.
 */
type Credentials = {
  readonly endpoints: ConnectionEndpoints | undefined;
  readonly clientId: ClientId | undefined;
  readonly secret: ClientSecret | undefined;
};

/**
 * What became of each credential sent to the project.
 */
type Published = {
  readonly clientId: PublishState | undefined;
  readonly secret: SecretOutcome | undefined;
};

/**
 * The project variables a connection reads its credentials from.
 *
 * @remarks
 * A credential the file holds as a value names no variable, so it is
 * `undefined`: there is nothing to publish to.
 */
type CredentialNames = {
  /**
   * The variable the client id is read from.
   */
  readonly clientId: ClientIdVariable | undefined;

  /**
   * The variable the client secret is read from.
   */
  readonly clientSecret: ClientSecretVariable | undefined;
};

/**
 * What {@link AuthMethodSsoEnable.askCredentials} asks about.
 */
type CredentialQuestion = {
  readonly selection: ProviderSelection;
  readonly reused: boolean;
  readonly givenClientId: ClientId | undefined;
  readonly names: CredentialNames;
};

/**
 * What {@link AuthMethodSsoEnable.publish} sends, and where.
 */
type CredentialDelivery = {
  readonly publish: SecretPublisher | undefined;
  readonly connection: Connection;
  readonly reused: boolean;
  readonly names: CredentialNames;
  readonly credentials: Credentials;
};

/**
 * What {@link AuthMethodSsoEnable.payload} words the result from.
 */
type PayloadInput = {
  /**
   * The Project the run addresses. `--json` suppresses the console line that
   * otherwise carries it, and a result that names only the schema does not
   * say which Project was changed.
   */
  readonly projectId: string;
  readonly provider: ProviderName;
  readonly schema: string;
  readonly connection: Connection;
  readonly reused: boolean;
  readonly callbackUri: string;
  readonly change: Change;
  readonly clientId: PublishState | undefined;
  readonly secret: SecretOutcome | undefined;
  readonly names: CredentialNames;
};

/**
 * A credential's variable, and whether the project holds its value.
 */
type PublishedVariable = {
  readonly variable: string;
  readonly published: PublishState;
};

/**
 * The machine-readable result. Never the secret, only whether it is held.
 */
type Payload = {
  readonly project_id: string;
  readonly provider: ProviderName;
  readonly schema: string;
  readonly connection: {
    readonly action: "reuse" | "create";
    readonly slug: string;
    readonly file: string;
  };
  readonly callback_uri: string;
  readonly changed: readonly string[];
  readonly notices: Change["notices"];
  readonly client_id: PublishedVariable | null;
  readonly secret: PublishedVariable | null;
};

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

  /**
   * Add the provider to the schema and its login flows, and publish its
   * credentials to the project.
   *
   * @param input - The provider, its settings, the schema and the environment flags.
   * @returns The result.
   * @throws {@link ZitadelError} When no provider is named, a setting is
   *   refused, the schema cannot be chosen, or no flow can offer the provider.
   */
  protected async execute(input: Admitted<typeof AuthMethodSsoEnable>): Promise<JsonEnvelope> {
    const flags = input.flags;
    if (flags.provider === undefined) {
      throw refusalError(PROVIDER_IS_NAMED_REFUSAL, {});
    }
    const project = ssoProvider(flags, {
      interactive: !this.nonInteractive && !this.dryRun,
    });
    const issuer = await developmentIssuer(this.cwd, flags, this.env);
    const target = await this.loadSchemaTarget(flags);
    const { config, schema } = target;
    // Refused before anything is asked: a provider no flow offers is no
    // sign-in button however well everything else goes.
    config.flows.resolveForSso(schema);
    // Resolved before anything else is asked for: being turned away after
    // typing a secret would mean typing it again.
    const { client, projectId, server } = await this.connect({ quiet: true });
    const selection = project.selection ?? (await this.askCustomSelection(target, project.values));
    const provider = providerOf(selection);
    const options = {
      clientId: flags.clientId,
      given: givenSettings(selection, flags.scopes !== undefined),
    };
    // Worked out before anything is asked or written, so every refusal comes
    // first: a connection that would step on another, a region the edits cannot
    // write, or a flow `deploy` would then reject (ADR 070 §3).
    const candidate = Connection.forProvider(provider, schema);
    const preview = config.connections.enable(schema, candidate, options);
    const connection = preview.document;
    const reused = !preview.created;

    // A loopback issuer works only on a server that may fetch from this machine.
    const reach = await loopbackReach(target.cwd, server);
    const loopback = loopbackIssuerWarning(selection, reach);
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
    // The connection's own route, so its slug decides it: a reused connection
    // keeps the slug it was created with.
    const callbackUri = callbackUriFor(issuer, connection.slug);
    const names = credentialNamesOf(connection);
    consola.info(`Project   ${escapeControlCharacters(projectId)}`);
    if (schema.methods.length > 0) {
      consola.info(`Schema    ${schema.path} (${schema.methods.join(", ")})`);
    } else {
      consola.info(`Schema    ${schema.path}`);
    }
    // Before the dry-run return, so a preview is enough to register the
    // client. Shown on reuse too: rerunning this command is how a developer
    // finds the callback URI to register.
    if (!reused) {
      consola.info(`${provider.displayName} needs an OAuth application.`);
    }
    consola.info(`Callback URI   ${callbackUri}`);
    // A custom provider has no console to send the developer to: it is
    // theirs, and the issuer they gave is the only address known.
    if (!reused && provider.consoleUrl === undefined) {
      consola.info(`Register it as a client at ${provider.issuer}, with the callback URI above.`);
    }
    if (!reused && provider.consoleUrl !== undefined) {
      consola.info(`Create it at   ${provider.consoleUrl}`);
    }

    const summary = {
      projectId,
      provider: selectionName(selection),
      schema: schema.name,
      connection,
      reused,
      callbackUri,
    };
    if (this.dryRun) {
      this.report(preview);
      // Nothing is asked or read: a reuse publishes only the credentials it is
      // given, and a dry run reads no piped secret, so none is listed.
      const reusedId =
        flags.clientId !== undefined && names.clientId !== undefined ? [names.clientId] : [];
      const toStore = reused ? reusedId : [names.clientId, names.clientSecret];
      const writes = preview.changedPaths.map((file) => {
        return `Would write ${file}`;
      });
      const stores =
        toStore.length > 0 ? [`Would store ${toStore.join(" and ")} on the project`] : [];
      const payload = this.payload({
        ...summary,
        change: preview,
        clientId: undefined,
        secret: undefined,
        names,
      });
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { ...payload, would_store: toStore },
        pretty: prose([...writes, ...stores].join("\n")),
      });
    }

    const credentials = await this.askCredentials({
      selection,
      reused,
      givenClientId: flags.clientId,
      names,
    });
    const change = this.withEndpoints(preview, credentials.endpoints, (endpoints) => {
      const located = candidate.withEndpoints(endpoints).document;
      return config.connections.enable(schema, located, options);
    });
    if (reused) {
      consola.success(`Reusing ${connection.path}`);
    }
    const written = await this.write(target, change);
    const published = await this.publish({
      publish: this.publisher(client, projectId),
      connection,
      reused,
      names,
      credentials,
    });
    this.report(change);
    const endpointIssuer = credentials.endpoints?.issuer;
    if (endpointIssuer !== undefined && endpointIssuer !== provider.issuer) {
      // A connection pointing somewhere other than the vendor is not what the
      // developer will want in the end, and nothing else would show it.
      reportWarning(`${provider.displayName} points at ${endpointIssuer}, not the provider`);
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
    const unpublished = !reused || written.length > 0;
    const stored =
      published.secret?.published === "stored" &&
      published.clientId !== "deferred" &&
      published.clientId !== "failed";
    const name = provider.displayName;
    const followUps = this.followUps(unpublished, scopeArgs, recovery);
    const configured = unpublished
      ? `${name} sign-in is configured locally.`
      : `${name} sign-in is already configured locally.`;
    const title =
      stored && unpublished
        ? `${configured} Provider credentials are stored on your Project.`
        : configured;
    const actions = [
      `Deploy the configuration to make ${name} sign-in available in your app, then reload your app and test ${name} sign-in.`,
    ];
    const payload = this.payload({
      ...summary,
      change,
      clientId: published.clientId,
      secret: published.secret,
      names,
    });
    const next = unpublished
      ? { actions, commands: followUps.commands }
      : { commands: followUps.commands };

    return this.emit({
      status: "ok",
      data: {
        title,
        ...payload,
        next_args: followUps.args,
      },
      next,
    });
  }

  /**
   * The custom connection a person describes, asking for the settings the
   * flags left out.
   *
   * @param target - What the run read.
   * @param values - The settings the flags gave.
   * @returns The provider, checked.
   * @throws {@link ZitadelError} When a setting is refused.
   */
  private async askCustomSelection(
    target: SchemaTarget,
    values: CustomFlagValues,
  ): Promise<ProviderSelection> {
    const settings = await this.askCustomSettings(target, values);
    const example = customExample(ENABLE_FLAG_NAMES);
    return selectionFromFlags(CUSTOM_PROVIDER, settings, ENABLE_FLAG_NAMES, example);
  }

  /**
   * The change to write: the preview, or the same change made again with the
   * endpoints a development run answered.
   *
   * @remarks
   * The endpoints change only a new connection's body, never which files the
   * change writes.
   *
   * @param preview - The change worked out before anything was asked.
   * @param endpoints - The endpoints a development run answered, if any.
   * @param remake - Makes the change again with the endpoints.
   * @returns The change.
   */
  private withEndpoints(
    preview: DocumentChange<Connection>,
    endpoints: ConnectionEndpoints | undefined,
    remake: (endpoints: ConnectionEndpoints) => DocumentChange<Connection>,
  ): DocumentChange<Connection> {
    if (endpoints === undefined) {
      return preview;
    }
    return remake(endpoints);
  }

  /**
   * The credentials the connection needs, asked for once nothing is left that
   * could refuse the run.
   *
   * @remarks
   * A new connection needs both: a sign-in button without them fails at the
   * provider, in a browser, not here. A reused one is given only what the
   * developer passes: the project may already hold its credentials, and an
   * unattended rerun should not start asking for them.
   *
   * @param input - The provider, whether the connection is reused, the
   *   client id `--client-id` gave, and the variables the credentials go to.
   * @returns The credentials, and the endpoints a development run answered.
   */
  private async askCredentials(input: CredentialQuestion): Promise<Credentials> {
    const provider = providerOf(input.selection);
    if (input.reused) {
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
    const endpoints = await this.askEndpoints(input.selection);
    const clientId = await this.input({
      kind: "text",
      name: `client id for ${provider.displayName}`,
      message: `What is the client ID of your ${provider.displayName} OAuth app?`,
      flag: "--client-id",
      parse: parseClientId,
      given: input.givenClientId,
      retry: this.retryFor(input.selection, "<client-id>", ""),
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
   * Where a catalog provider lives, on a development run only.
   *
   * @param selection - The provider.
   * @returns The endpoints, or `undefined` for a custom provider or a normal run.
   */
  private async askEndpoints(
    selection: ProviderSelection,
  ): Promise<ConnectionEndpoints | undefined> {
    if (selection.kind !== "catalog") {
      return undefined;
    }
    return askConnectionEndpoints({
      provider: selection.id,
      developmentBuild: isDevelopmentBuild() && !this.nonInteractive,
      ask: this.input,
    });
  }

  /**
   * What an agent can run once a missing credential is to hand. Only for a
   * catalog provider: a custom connection needs its settings repeated too.
   *
   * @param selection - The provider.
   * @param clientId - The client id, or a placeholder for it.
   * @param pipe - What feeds the secret on stdin, if anything.
   * @returns The command, or `undefined` for a custom provider.
   */
  private retryFor(
    selection: ProviderSelection,
    clientId: string,
    pipe: string,
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
   * developer can read back afterwards.
   *
   * @remarks
   * A credential the connection holds as a value has no variable to go to,
   * which is said instead.
   *
   * @param input - Where the credentials go, the connection, whether it is
   *   reused, its variables, and the credentials.
   * @returns What became of each credential.
   */
  private async publish(input: CredentialDelivery): Promise<Published> {
    const { publish, connection, reused, names, credentials } = input;
    const selector = this.environmentSelector();
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
    const clientId = await this.publishClientId(names, credentials, publish);
    const secret = await this.storeSecret(names, credentials, publish);
    if (clientId !== undefined && names.clientId !== undefined) {
      reportClientIdOutcome(names.clientId, clientId, this.cliVersion, selector);
    }
    if (secret !== undefined) {
      reportSecretOutcome(secret, this.cliVersion, reused, selector);
    }
    return { clientId, secret };
  }

  /**
   * Publish the client id, when there is one and a variable to hold it.
   *
   * @param names - The connection's variables.
   * @param credentials - The credentials.
   * @param publish - Where it goes.
   * @returns Whether it reached the project, or `undefined` when nothing was sent.
   */
  private async publishClientId(
    names: CredentialNames,
    credentials: Credentials,
    publish: SecretPublisher | undefined,
  ): Promise<PublishState | undefined> {
    if (credentials.clientId === undefined || names.clientId === undefined) {
      return undefined;
    }
    return publishClientId({ name: names.clientId, value: credentials.clientId, publish });
  }

  /**
   * Store the client secret, when there is one and a variable to hold it.
   *
   * @param names - The connection's variables.
   * @param credentials - The credentials.
   * @param publish - Where it goes.
   * @returns Where it ended up, or `undefined` when nothing was sent.
   */
  private async storeSecret(
    names: CredentialNames,
    credentials: Credentials,
    publish: SecretPublisher | undefined,
  ): Promise<SecretOutcome | undefined> {
    if (credentials.secret === undefined || names.clientSecret === undefined) {
      return undefined;
    }
    return storeClientSecret({ name: names.clientSecret, value: credentials.secret, publish });
  }

  /**
   * How the connection's credentials reach the project.
   *
   * @remarks
   * It writes to the project's own variables, which is where the engine
   * resolves a connection's `${{ NAME }}` references from.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project.
   * @returns The publisher, or `undefined` when there is no project behind this
   *   run: `--source mock` answers from fixtures and has no variables to write.
   */
  private publisher(client: ZitadelClient, projectId: string): SecretPublisher | undefined {
    if (this.meta.source === "mock") {
      return undefined;
    }
    const variableService = new VariableService(client, projectId);
    return async (name, value, options) => {
      const write = VariableWrite.of({ secret: options.secret, preview: false });
      await variableService.set(name, value, write);
    };
  }

  /**
   * The settings of a custom connection, asking only for the ones not already
   * given.
   *
   * @remarks
   * The slug comes first because it decides the most: a connection that
   * already has it answers the rest from its file, and one that connects to
   * another issuer, or that a login flow would reject, is refused the moment
   * the slug is typed. A given value goes through the same parser as a typed
   * one.
   *
   * @param target - What the run read.
   * @param given - The settings the flags gave.
   * @returns Every setting.
   * @throws {@link ZitadelError} When the slug names a connection to another
   *   issuer, or a flow would reject the provider.
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
    const checkedIssuer = givenIssuer?.ok ? givenIssuer.value : undefined;
    const existing = target.config.connections.resolveBySlug(slug, checkedIssuer);
    // A flow `deploy` would reject once it offers the slug is refused now,
    // before the rest of the connection is asked for.
    target.config.flows.resolveForSso(target.schema, slug);
    // An existing connection is described by its file, so nothing it already
    // holds is asked again; reuse never applies scopes, so they are not asked.
    const stored = existing?.readStoredSettings(given);
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
    const defaultScopes = DEFAULT_SCOPES.join(" ");
    const keptScopes = existing === undefined ? undefined : defaultScopes;
    const scopes = await this.input({
      kind: "text",
      name: "scopes",
      message: "Which scopes should we request? Separate them with spaces.",
      parse: parseScopes,
      given: given.scopes ?? keptScopes,
      initialValue: defaultScopes,
    });
    return { slug, displayName, issuer, scopes: scopes.join(" ") };
  }

  /**
   * The machine-readable result. Never the secret, only whether it is held.
   *
   * @param input - The run's project, provider, schema, connection, change and
   *   what became of each credential.
   * @returns The result's data.
   */
  private payload(input: PayloadInput): Payload {
    const names = input.names;
    const secret = input.secret;
    const action = input.reused ? "reuse" : "create";
    const clientId = publishedClientId(names, input.clientId);
    const storedSecret =
      secret === undefined ? null : { variable: secret.name, published: secret.published };
    return {
      project_id: input.projectId,
      provider: input.provider,
      schema: input.schema,
      connection: {
        action,
        slug: input.connection.slug,
        file: input.connection.path,
      },
      callback_uri: input.callbackUri,
      changed: [...input.change.changedPaths],
      notices: input.change.notices,
      client_id: clientId,
      secret: storedSecret,
    };
  }
}

/**
 * The project variables a connection's credentials are published to.
 *
 * @remarks
 * A connection with no `oidc` block leaves both to the variables its slug
 * derives.
 *
 * @param connection - The connection.
 * @returns The client id's and client secret's variables.
 */
function credentialNamesOf(connection: Connection): CredentialNames {
  const credentials = connection.credentials;
  if (credentials === undefined) {
    return credentialVariables(connection.slug);
  }
  return {
    clientId: variableOf(credentials.clientId),
    clientSecret: variableOf(credentials.clientSecret),
  };
}

/**
 * The variable a credential references.
 *
 * @typeParam Variable - The kind of variable the credential's field references.
 * @param credential - The credential.
 * @returns The variable, or `undefined` when the credential is held as a value.
 */
function variableOf<Variable extends ClientIdVariable | ClientSecretVariable>(
  credential: Credential<"client_id" | "client_secret", Variable>,
): Variable | undefined {
  if (credential.kind === "literal") {
    return undefined;
  }
  return credential.variable;
}

/**
 * The client id's variable and what became of it, for the result.
 *
 * @param names - The connection's variables.
 * @param published - What became of the client id, if it was sent.
 * @returns Both, or `null` when it was not sent or has no variable.
 */
function publishedClientId(
  names: CredentialNames,
  published: PublishState | undefined,
): PublishedVariable | null {
  if (published === undefined || names.clientId === undefined) {
    return null;
  }
  return { variable: names.clientId, published };
}

/**
 * The connection settings the developer gave, which an existing connection
 * may not have: a custom connection's display name, and its scopes when
 * `--scopes` was passed. A catalog provider's settings are the catalog's.
 *
 * @param selection - The provider.
 * @param scopesGiven - Whether `--scopes` was passed.
 * @returns The settings given.
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
