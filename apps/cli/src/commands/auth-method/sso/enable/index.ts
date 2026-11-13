import { Flags } from "@oclif/core";
import {
  type ClientId,
  type ClientIdVariable,
  type ClientSecretVariable,
  type ConnectionEndpoints,
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  type IdpProvider,
  parseClientId,
  parseConnectionSlug,
  type Parsed,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  type ProviderName,
  providerOf,
  type ProviderSelection,
  RESERVED_SLUGS,
  selectionName,
  validated,
} from "@zitadel/config/idp";
import { z } from "zod";

import { AuthMethodCommand, type SchemaTarget } from "@/commands/auth-method/command";
import {
  isCancelled,
  Origins,
  OriginService,
  VariableService,
  VariableWrite,
  type ZitadelClient,
} from "@/lib/backend";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { resolveEnvironment } from "@/lib/environment";
import {
  callbackUriFor,
  CredentialDelivery,
  type CredentialNames,
  CredentialPrompt,
  customExample,
  ENABLE_FLAG_NAMES,
  type GivenCredentials,
  loopbackIssuerWarning,
  ProviderChoice,
  type PublishedCredentials,
  type PublishState,
  type SecretOutcome,
  type SecretPublisher,
} from "@/lib/idp";
import { loopbackReach } from "@/lib/local-server/runtime";
import { log } from "@/lib/log";
import { type Admitted, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { environmentFlags } from "@/lib/oclif/environment-flags";
import { filled, reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";

import type { SuggestedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import {
  type Change,
  Connection,
  type ConnectionSummary,
  type DocumentChange,
  type UserSchema,
} from "@/lib/zitadel";

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
const CLIENT_ID = {
  schema: filled.transform((id) => {
    return validated(parseClientId(id));
  }),
  refusal: {
    message: "{input} was given an empty value",
    hint: "Pass a value for {input}, or omit it entirely.",
  },
} as const satisfies Refused<ClientId>;

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
const PROVIDER_IS_NAMED_REFUSAL = {
  message: "Name the provider to enable",
  hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}.`,
} as const satisfies Refusal;

/**
 * What a Project with no development issuer is refused for.
 */
const NO_ISSUER_REFUSAL = {
  message: "This project has no development issuer",
  hint: "Set the project up first, or set ZITADEL_ISSUER to the origin your app serves from.",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

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
 * What a run says about the connection it adds, before any credential is
 * asked for.
 */
type Summary = {
  /**
   * The Project the run addresses. `--json` suppresses the console line that
   * otherwise carries it, and a result that names only the schema does not
   * say which Project was changed.
   */
  readonly projectId: string;

  /**
   * The provider, as a command line names it.
   */
  readonly provider: ProviderName;

  /**
   * The name a sign-in button and every message show for the provider.
   */
  readonly displayName: string;

  /**
   * The schema the provider is added to.
   */
  readonly schema: string;

  /**
   * The connection the schema lists: the one created, or the one reused.
   */
  readonly connection: Connection;

  /**
   * Whether the connection was already in the project.
   */
  readonly reused: boolean;

  /**
   * The redirect URI to register with the provider, on the Project's
   * development issuer.
   */
  readonly callbackUri: string;

  /**
   * The redirect URI on each primary origin, where a deploy lands the app.
   */
  readonly deployedCallbackUris: readonly string[];

  /**
   * The redirect URI pattern for each preview origin. A preview URL is one
   * pull-request build of the same app, so each needs its own entry at the
   * provider, and a wildcard pattern cannot be registered as one.
   */
  readonly previewCallbackUris: readonly string[];
};

/**
 * What {@link AuthMethodSsoEnable.summarize} words the summary from.
 */
type SummaryInput = {
  readonly projectId: string;
  readonly selection: ProviderSelection;
  readonly target: SchemaTarget;
  readonly preview: DocumentChange<Connection>;
  readonly issuer: string;
  readonly origins: Origins;
};

/**
 * What {@link AuthMethodSsoEnable.reportOutcome} reports on.
 */
type Outcome = {
  readonly change: Change;
  readonly written: readonly string[];
  readonly provider: IdpProvider;
  readonly given: GivenCredentials;
  readonly schema: UserSchema;
};

/**
 * What {@link AuthMethodSsoEnable.result} words the result from.
 */
type ResultInput = {
  readonly summary: Summary;
  readonly change: DocumentChange<Connection>;
  readonly written: readonly string[];
  readonly published: PublishedCredentials;
  readonly delivery: CredentialDelivery;
};

/**
 * What {@link AuthMethodSsoEnable.payload} words the result's data from.
 */
type PayloadInput = {
  readonly summary: Summary;
  readonly change: DocumentChange<Connection>;
  readonly published: PublishedCredentials;
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
    readonly claim_mapping: Readonly<Record<string, string>>;
    readonly verified_claims: Readonly<Record<string, string | boolean>>;
    readonly scopes: readonly string[];
    readonly unmapped: ConnectionSummary["unmapped"];
    readonly used_by: readonly string[];
  };
  readonly callback_uri: string;
  readonly changed: readonly string[];
  readonly notices: Change["notices"];
  readonly client_id: PublishedVariable | null;
  readonly secret: PublishedVariable | null;
};

/**
 * Nothing sent to the project, as a dry run reports it.
 */
const NOTHING_PUBLISHED: PublishedCredentials = {
  clientId: undefined,
  secret: undefined,
};

/**
 * `zitadel auth-method sso enable` — add a provider to a Project's sign-in
 * methods.
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
  static override baseFlags = {
    ...AuthMethodCommand.baseFlags,
    ...environmentFlags,
  };
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
   * @param input.flags - The provider, its settings, the schema and the environment flags.
   * @returns The result.
   * @throws {@link ZitadelError} When no provider is named, a setting is
   *   refused, the schema cannot be chosen, or no flow can offer the provider.
   */
  protected async execute({ flags }: Admitted<typeof AuthMethodSsoEnable>): Promise<JsonEnvelope> {
    if (flags.provider === undefined) {
      throw refusalError(PROVIDER_IS_NAMED_REFUSAL, {});
    }
    const choice = ProviderChoice.fromFlags(flags, {
      interactive: !this.nonInteractive && !this.dryRun,
    });
    const issuer = await developmentIssuer(this.cwd, flags, this.env);
    const target = await this.loadSchemaTarget(flags);
    // Refused before anything is asked: a provider no flow offers is no
    // sign-in button however well everything else goes.
    target.config.flows.resolveForSso(target.schema);
    // Resolved before anything else is asked for: being turned away after
    // typing a secret would mean typing it again.
    const remote = await this.connect();
    // Read only to name more callback URIs: a platform that cannot answer still
    // gets the local one, and the run goes on. A cancelled run stops instead,
    // as OriginService.remove does.
    const origins = await new OriginService(remote.client, remote.projectId)
      .list()
      .catch((cause: unknown) => {
        if (isCancelled(remote.client)) {
          throw cause;
        }
        return Origins.wrap([]);
      });
    const selection = await choice.resolve(target, this.ask);
    const provider = providerOf(selection);
    const options = {
      clientId: flags.clientId,
      given: choice.givenSettings(selection),
      dryRun: this.dryRun,
    };
    // Worked out before anything is asked or written, so every refusal comes
    // first: a connection that would step on another, a region the edits cannot
    // write, or a flow `deploy` would then reject (ADR 070 §3).
    const candidate = Connection.forProvider(provider, target.schema);
    const preview = target.config.connections.enable(target.schema, candidate, options);
    await this.warnOfUnreachableIssuer(target, selection, remote.server);
    const delivery = this.deliveryFor(preview);
    const prompt = this.promptFor(selection, preview, delivery.names);
    const summary = this.summarize({
      projectId: remote.projectId,
      selection,
      target,
      preview,
      issuer,
      origins,
    });
    this.introduce(summary, target.schema, provider);
    if (this.dryRun) {
      // What the developer typed, so the real run is one command away.
      const real = await this.realRun();

      return this.previewResult(summary, preview, delivery.names, flags.clientId, real);
    }

    const given = await prompt.ask(flags.clientId);
    const change = this.withEndpoints(preview, given.endpoints, (endpoints) => {
      const located = candidate.withEndpoints(endpoints).document;
      return target.config.connections.enable(target.schema, located, options);
    });
    if (summary.reused) {
      log.done(`Reusing ${escapeControlCharacters(summary.connection.path)}`);
    }
    // The credentials go before the files: saving writes the connection first,
    // so a write that then fails would leave a connection on disk whose
    // credentials were never stored, and the rerun would take it as reused and
    // not ask for them again. Published first, a failed write leaves nothing
    // behind but credentials the rerun asks for and stores again. Saving's own
    // refusals are checked before that, so a path it would refuse leaves the
    // project's variables alone too.
    await change.check(target.store);
    const published = await delivery.publish(
      given,
      this.publisher(remote.client, remote.projectId),
    );
    const written = await this.write(target, change, undefined);
    this.reportOutcome({
      change,
      written,
      provider,
      given,
      schema: target.schema,
    });
    return this.result({
      summary,
      change,
      written,
      published,
      delivery,
    });
  }

  /**
   * Warn of a loopback issuer, which works only on a server that may fetch
   * from this machine.
   *
   * @param target - What the run read.
   * @param selection - The provider.
   * @param server - The server the run targets.
   */
  private async warnOfUnreachableIssuer(
    target: SchemaTarget,
    selection: ProviderSelection,
    server: string,
  ): Promise<void> {
    const reach = await loopbackReach(target.cwd, server);
    const loopback = loopbackIssuerWarning(selection, reach);
    if (loopback !== undefined) {
      reportWarning(loopback);
    }
  }

  /**
   * Where the connection's credentials go, reported the way this run reports.
   *
   * @param preview - The change worked out before anything was asked.
   * @returns The delivery.
   */
  private deliveryFor(preview: DocumentChange<Connection>): CredentialDelivery {
    return new CredentialDelivery({
      connection: preview.document,
      reused: !preview.created,
      suggest: this.suggest,
    });
  }

  /**
   * The questions that ask for the connection's credentials, the way this run
   * asks.
   *
   * @param selection - The provider.
   * @param preview - The change worked out before anything was asked.
   * @param names - The variables the credentials go to.
   * @returns The prompt.
   */
  private promptFor(
    selection: ProviderSelection,
    preview: DocumentChange<Connection>,
    names: CredentialNames,
  ): CredentialPrompt {
    return new CredentialPrompt({
      selection,
      reused: !preview.created,
      secretVariable: names.clientSecret,
      ask: this.ask,
      developmentBuild: isDevelopmentBuild() && !this.nonInteractive,
      suggest: this.suggest,
    });
  }

  /**
   * What the run says about the connection it adds.
   *
   * @remarks
   * The callback URI is the connection's own route, so its slug decides it: a
   * reused connection keeps the slug it was created with.
   *
   * @param input - The project, the provider, what the run read, the change
   *   worked out before anything was asked, and the Project's issuer.
   * @returns The summary.
   */
  private summarize(input: SummaryInput): Summary {
    const connection = input.preview.document;
    const callbackUri = callbackUriFor(input.issuer, connection.slug);
    // A Set first: two spellings of one origin, such as with and without a
    // trailing slash, name the same redirect URI, which is listed once.
    const deployedCallbackUris = [
      ...new Set(
        input.origins.primary.map((origin) => {
          return callbackUriFor(origin, connection.slug);
        }),
      ),
    ].filter((uri) => {
      return uri !== callbackUri;
    });
    const previewCallbackUris = [
      ...new Set(
        input.origins.preview.map((pattern) => {
          return callbackUriFor(pattern, connection.slug);
        }),
      ),
    ].filter((uri) => {
      return uri !== callbackUri && !deployedCallbackUris.includes(uri);
    });
    return {
      projectId: input.projectId,
      provider: selectionName(input.selection),
      displayName: providerOf(input.selection).displayName,
      schema: input.target.schema.name,
      connection,
      reused: !input.preview.created,
      callbackUri,
      deployedCallbackUris,
      previewCallbackUris,
    };
  }

  /**
   * Say what the run addresses and what to register with the provider.
   *
   * @remarks
   * Said before a dry run returns, so a preview is enough to register the
   * client. The callback URI is shown on reuse too: rerunning this command is
   * how a developer finds the URI to register.
   *
   * @param summary - What the run says about the connection.
   * @param schema - The schema the provider is added to.
   * @param provider - The provider.
   */
  private introduce(summary: Summary, schema: UserSchema, provider: IdpProvider): void {
    log.info(
      `Editing ${escapeControlCharacters(schema.path)}${schema.methods.length > 0 ? `, which offers ${escapeControlCharacters(schema.methods.join(", "))}` : ""}`,
    );
    if (!summary.reused) {
      log.info(
        `${escapeControlCharacters(provider.displayName, { keepLayout: false })} needs an OAuth application.`,
      );
    }
    log.info(
      `Callback URI   ${escapeControlCharacters(summary.callbackUri, { keepLayout: false })}`,
    );
    for (const uri of summary.deployedCallbackUris) {
      log.info(`Callback URI   ${escapeControlCharacters(uri, { keepLayout: false })}`);
    }
    if (summary.previewCallbackUris.length > 0) {
      log.info(
        "Each preview URL needs its own callback URI at the provider, since it takes no wildcards:",
      );
      for (const uri of summary.previewCallbackUris) {
        log.info(`  ${escapeControlCharacters(uri, { keepLayout: false })}`);
      }
    }
    // A custom provider has no console to send the developer to: it is
    // theirs, and the issuer they gave is the only address known.
    if (!summary.reused && provider.consoleUrl === undefined) {
      log.info(
        `Register it as a client at ${escapeControlCharacters(provider.issuer)}, with the callback URI above.`,
      );
    }
    if (!summary.reused && provider.consoleUrl !== undefined) {
      log.info(`Create it at   ${escapeControlCharacters(provider.consoleUrl)}`);
    }
  }

  /**
   * The result of a dry run: what would be written and stored, with nothing
   * asked or read.
   *
   * @param summary - What the run says about the connection.
   * @param change - The change worked out before anything was asked.
   * @param names - The variables the credentials would go to.
   * @param givenClientId - The client id `--client-id` gave, if any.
   * @param real - The real run, as the developer typed it.
   * @returns The dry run's result.
   */
  private previewResult(
    summary: Summary,
    change: DocumentChange<Connection>,
    names: CredentialNames,
    givenClientId: ClientId | undefined,
    real: SuggestedCommand,
  ): JsonEnvelope {
    this.report(change);
    if (!this.isJson) {
      this.drawMapping(change);
    }
    const toStore = this.wouldStore(summary.reused, names, givenClientId);
    const stores =
      toStore.length > 0
        ? [
            `Would store ${new Intl.ListFormat("en", { type: "conjunction" }).format(toStore)} on the project`,
          ]
        : [];
    const said = [
      ...change.changedPaths.map((file) => {
        return `Would write ${file}`;
      }),
      ...stores,
    ];

    const title = escapeControlCharacters(
      said[0] === undefined ? "Nothing would change (dry run)" : `${said[0]} (dry run)`,
    );

    return this.emit({
      status: "ok",
      data: {
        ...this.payload({
          summary,
          change,
          published: NOTHING_PUBLISHED,
          names,
        }),
        title,
        would_store: toStore,
        dry_run: true,
        next_args: [this.argsOf(real)],
      },
      summary: {
        title,
        sections: [],
        lines: said.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
      next: { commands: [real] },
    });
  }

  /**
   * The variables a dry run would store a credential in.
   *
   * @remarks
   * Nothing is asked or read: a reuse publishes only the credentials it is
   * given, and a dry run reads no piped secret, so none is listed.
   *
   * @param reused - Whether the connection was already in the project.
   * @param names - The connection's variables.
   * @param givenClientId - The client id `--client-id` gave, if any.
   * @returns The variables.
   */
  private wouldStore(
    reused: boolean,
    names: CredentialNames,
    givenClientId: ClientId | undefined,
  ): readonly (ClientIdVariable | ClientSecretVariable)[] {
    // A credential the file holds as a value names no variable, so it is left out.
    if (!reused) {
      return [names.clientId, names.clientSecret].filter((name) => {
        return name !== undefined;
      });
    }
    if (givenClientId !== undefined && names.clientId !== undefined) {
      return [names.clientId];
    }
    return [];
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
      const write = VariableWrite.of({
        secret: options.secret,
        preview: false,
      });
      await variableService.set(name, value, write);
    };
  }

  /**
   * Say what the configuration said about the change, and what else the
   * developer would not otherwise see.
   *
   * @param outcome - The change, the files written, the provider, the
   *   credentials and endpoints the run was given, and the schema.
   */
  private reportOutcome(outcome: Outcome): void {
    const provider = outcome.provider;
    this.report(outcome.change);
    const endpointIssuer = outcome.given.endpoints?.issuer;
    if (endpointIssuer !== undefined && endpointIssuer !== provider.issuer) {
      // A connection pointing somewhere other than the vendor is not what the
      // developer will want in the end, and nothing else would show it.
      reportWarning(`${provider.displayName} points at ${endpointIssuer}, not the provider`);
    }
    if (outcome.written.length === 0 && outcome.change.notices.length === 0) {
      log.info(
        `${escapeControlCharacters(outcome.schema.name)} and its login flow already offer ${escapeControlCharacters(provider.displayName, { keepLayout: false })}`,
      );
    }
  }

  /**
   * The result of a run that wrote the configuration and published the
   * credentials.
   *
   * @remarks
   * Its next commands are `variable set` first, for a credential that did not
   * reach the project, then deploy, when a file changed. All carry `--cwd` and
   * the run's environment.
   *
   * @param input - The summary, the change, the files written, what became of
   *   each credential, and where they went.
   * @returns The result.
   */
  private result(input: ResultInput): JsonEnvelope {
    const summary = input.summary;
    const name = summary.displayName;
    const recovery = input.delivery.unpublishedOf(input.published).map((missing) => {
      return this.suggest({
        id: "variable:set",
        args: { name: missing.name },
        flags: { secret: missing.secret },
      });
    });
    const unpublished = !summary.reused || input.written.length > 0;
    const stored = input.delivery.areStored(input.published);
    const followUps = this.followUps(unpublished, recovery);
    const payload = this.payload({
      summary,
      change: input.change,
      published: input.published,
      names: input.delivery.names,
    });

    if (!this.isJson) {
      this.drawMapping(input.change);
    }

    const title = this.title(name, unpublished);

    return this.emit({
      status: "ok",
      data: {
        title,
        ...payload,
        next_args: followUps.args,
      },
      summary: {
        title: escapeControlCharacters(title),
        sections: [],
        lines: unpublished && stored ? ["Its credentials are stored in your project."] : [],
      },
      // The deploy commands are listed once, in `commands`, so the prose names none.
      next: unpublished
        ? {
            actions: [
              `Deploy it to make ${name} sign-in available in your app, then reload the app and test it`,
            ],
            commands: followUps.commands,
          }
        : { commands: followUps.commands },
    });
  }

  /**
   * Print what the connection maps: which claim fills each user
   * attribute and what verifies it, the scopes it asks for, the attributes no
   * claim fills, the schemas that sign in through it, and where to change it.
   *
   * @remarks
   * Every value read from a file is escaped on its own, newlines included, so a
   * name cannot drive the terminal or forge a line of the notice.
   *
   * @param change - The change that adds the connection.
   */
  private drawMapping(change: DocumentChange<Connection>): void {
    const text = (value: string) => {
      return escapeControlCharacters(value, { keepLayout: false });
    };
    const connection = change.document;
    const { mappings, verifications, scopes, createsUsers, unmapped, usedBy } =
      change.after.connections.summarize(connection);
    const verifiedBy = new Map(
      verifications.map(({ property, claim }) => {
        return [property, claim];
      }),
    );
    const sections = [
      mappings.length === 0
        ? []
        : [
            createsUsers
              ? `When someone signs in with ${text(connection.displayName)} for the first time, Zitadel fills in their new user like this:`
              : `${text(connection.displayName)} does not create users in Zitadel, so these claims are not used to fill one:`,
            ...mappings.map(({ property, claim }) => {
              const how = verifiedBy.get(property);
              const verified =
                how === true
                  ? "always counts as verified"
                  : typeof how === "string"
                    ? `counts as verified when ${text(how)} is true`
                    : "is not treated as verified";
              return [
                `- ${text(property)} comes from the provider's ${text(claim)} claim.`,
                `  It ${verified}.`,
              ].join("\n");
            }),
          ],
      scopes.length === 0
        ? []
        : [
            `Zitadel asks ${text(connection.displayName)} for these scopes: ${new Intl.ListFormat("en", { type: "conjunction" }).format(scopes.map(text))}.`,
          ],
      unmapped.length === 0
        ? []
        : [
            "These attributes have no claim yet:",
            ...unmapped.map(({ property, required }) => {
              if (!required) {
                return `- ${text(property)} is optional, so it can stay empty.`;
              }
              return createsUsers
                ? `- ${text(property)} is required, so sign-up will have to ask for it.`
                : `- ${text(property)} is required, but this connection does not create users.`;
            }),
          ],
      usedBy.length === 0
        ? []
        : [
            `This connection is used by ${new Intl.ListFormat("en", { type: "conjunction" }).format(usedBy.map(text))}, so a change here affects the people who sign in with it.`,
          ],
      [
        `To change which claim fills an attribute, edit claim_mapping in ${text(connection.path)} and run deploy.`,
      ],
    ].filter((section) => {
      return section.length > 0;
    });
    log.info(
      sections
        .flatMap((section, at) => {
          return at === 0 ? section : ["", ...section];
        })
        .join("\n"),
    );
  }

  /**
   * The result's title: whether the provider is configured. The terminal and
   * the envelope say it in these same words.
   *
   * @param name - The provider's display name.
   * @param unpublished - Whether the configuration has changes to deploy.
   * @returns The title.
   */
  private title(name: string, unpublished: boolean): string {
    if (!unpublished) {
      return `${name} sign-in is already configured locally`;
    }
    return `${name} sign-in is configured locally`;
  }

  /**
   * The machine-readable result. Never the secret, only whether it is held.
   *
   * @param input - The summary, the change, what became of each credential,
   *   and the variables they go to.
   * @returns The result's data.
   */
  private payload(input: PayloadInput): Payload {
    const summary = input.summary;
    const action = summary.reused ? "reuse" : "create";
    const mapped = input.change.after.connections.summarize(input.change.document);
    return {
      project_id: summary.projectId,
      provider: summary.provider,
      schema: summary.schema,
      connection: {
        action,
        slug: summary.connection.slug,
        file: summary.connection.path,
        claim_mapping: Object.fromEntries(
          mapped.mappings.map(({ property, claim }) => {
            return [property, claim];
          }),
        ),
        verified_claims: Object.fromEntries(
          mapped.verifications.map(({ property, claim }) => {
            return [property, claim];
          }),
        ),
        scopes: mapped.scopes,
        unmapped: mapped.unmapped,
        used_by: mapped.usedBy,
      },
      callback_uri: summary.callbackUri,
      changed: [...input.change.changedPaths],
      notices: input.change.notices,
      client_id: this.publishedClientId(input.names, input.published.clientId),
      secret: this.storedSecret(input.published.secret),
    };
  }

  /**
   * The client id's variable and what became of it, for the result.
   *
   * @param names - The connection's variables.
   * @param published - What became of the client id, if it was sent.
   * @returns Both, or `null` when it was not sent or has no variable.
   */
  private publishedClientId(
    names: CredentialNames,
    published: PublishState | undefined,
  ): PublishedVariable | null {
    if (published === undefined || names.clientId === undefined) {
      return null;
    }
    return {
      variable: names.clientId,
      published,
    };
  }

  /**
   * The client secret's variable and where it ended up, for the result.
   *
   * @param secret - Where the secret ended up, if it was sent.
   * @returns Both, or `null` when it was not sent.
   */
  private storedSecret(secret: SecretOutcome | undefined): PublishedVariable | null {
    if (secret === undefined) {
      return null;
    }
    return {
      variable: secret.name,
      published: secret.published,
    };
  }
}
