import { consola } from "consola";

import { createZitadelClient } from "../api-client";
import {
  type Environment,
  requireValueInteractive,
  resolveEnvironment,
  storedBySetup,
} from "../environment";
import { resolveCwd } from "../paths";
import { BaseCommand, type MetaOptions } from "./base";
import { byName } from "./names";
import { CREDENTIALS, type CredentialKind, type CredentialUsed, signInAt } from "./credentials";
import {
  ENVIRONMENT_SELECTOR_OPTIONS,
  environmentFlags,
  environmentSelectorSuffix,
  ignoredCredentialFlag,
} from "./environment-flags";
import { type Refusal, refusalError } from "./refusal";
import type { ConnectOptions, Connection, GlobalOptions } from "./types";

export type { Connection } from "./types";
import {
  type EnvironmentSelector,
  projectCommand,
  type SuggestedCommand,
  unscopedCommand,
} from "../suggestion";
import { optionArgs } from "../public-cli";
import { Cmd } from "../cmd";

/** What `--credential` forces, as the flag takes it. */
type ForcedCredential = "project" | "login";

/** The credential a run connects with, once chosen. */
type Chosen = Readonly<{ used: CredentialUsed; token: string; who?: string }>;

const NEVER_AS_YOU_REFUSAL: Refusal = {
  message: "zitadel {command} never acts as you, so it cannot take --credential login",
  hint: "It authenticates with {variable}. Leave out --credential, or pass --credential project.",
};

const NOT_SIGNED_IN_REFUSAL: Refusal = {
  code: "E_CREDENTIAL_MISSING",
  message: "You are not signed in to {server}, and --credential login acts only as you",
  hint: "Sign in with `zitadel login --server {server}`, which opens a browser, or leave out --credential to use the project secret.",
  next: ["login --server {server}"],
};

/**
 * A command that talks to a project. The server, the project and the
 * credential all come from the environment it runs in — `--env`,
 * `--env-file`, the process environment and the `.env` files, then
 * `.zitadel/secret` — so every such command resolves them the same way and
 * fails the same way when one is missing.
 *
 * Which secret it authenticates with is `static credential`; the project
 * secret unless a subclass says otherwise. The developer's own sign-in
 * (`zitadel login`) may act in its place, by the order {@link connect}
 * chooses in, unless `static acceptsSignIn` says no.
 */
export abstract class EnvironmentCommand extends BaseCommand {
  static override baseFlags = { ...BaseCommand.baseFlags, ...environmentFlags };

  static credential: CredentialKind = "project";

  /**
   * Whether the person signed in to the server may act in place of the
   * secret. A command that must prove it holds the secret, or whose
   * operations a person's token cannot call, says no, and hides
   * `--credential`.
   */
  static acceptsSignIn = true;

  private readonly connections = new Map<string, Promise<Connection>>();

  /** The credential this run connects with, chosen once for every connection it opens. */
  private choosing: Promise<Chosen> | undefined;

  /** What the invocation resolved to; set by {@link toMeta}. */
  protected environment!: Environment;

  /** `--cwd` as typed, reproduced by {@link environmentSelector}. */
  private cwdFlag: string | undefined;

  /** `--credential` as typed, reproduced by {@link environmentSelector}. */
  private credentialFlag: ForcedCredential | undefined;

  /**
   * Resolve the environment, then build the invocation context from its server.
   *
   * A missing server is not an error here: whether a command needs one is for
   * {@link connect} to say, so `zitadel env` can show an environment that
   * resolves to nothing. `options.source` stands in for `--server`, for the
   * commands that read the server from somewhere the chain does not know (the
   * local runtime metadata `status --server local` reads).
   */
  protected override async toMeta(
    given: Record<string, unknown>,
    options: MetaOptions = {},
  ): Promise<GlobalOptions> {
    const flags = byName(given);
    const text = (value: unknown): string | undefined =>
      typeof value === "string" ? value : undefined;
    this.cwdFlag = text(flags.cwd);
    this.credentialFlag =
      flags.credential === "project" || flags.credential === "login" ? flags.credential : undefined;
    // A command that only edits files in the project directory resolves none:
    // a stray ZITADEL_ENV must not stop it, and it names no server or project.
    if (options.environment === false) {
      return super.toMeta(given, { resolveServer: options.resolveServer, source: options.source });
    }
    this.environment = await resolveEnvironment({
      cwd: resolveCwd(text(flags.cwd)),
      env: process.env,
      serverFlag: options.source ?? text(flags.server),
      envName: text(flags.env),
      envFile: text(flags.envFile),
    });
    return super.toMeta(given, {
      resolveServer: false,
      source: this.environment.values.ZITADEL_URL?.value ?? "",
    });
  }

  /**
   * The flags that reproduce this invocation's environment selection, as a
   * suffix to append to a `zitadel` command this run suggests (e.g.
   * ` --env production`). A retry the CLI prints must resolve the same server,
   * project and credential this run did; without the selector it would fall
   * back to the default environment and quietly target the wrong project.
   *
   * Only flags actually passed are reproduced: a name that came from
   * `ZITADEL_ENV` or a platform signal needs none, because the next run in the
   * same environment inherits it. `--env` and `--env-file` are mutually
   * exclusive; `--server` (the URL only) can accompany either. Empty when the
   * invocation used no selector.
   */
  protected environmentSelector(): EnvironmentSelector {
    const { environment } = this;
    return environmentSelectorSuffix({
      cwd: this.cwdFlag,
      envFile: environment.envFile,
      envName: environment.name.source === "--env" ? environment.name.value : undefined,
      credential: this.credentialFlag,
      server:
        environment.values.ZITADEL_URL?.source === "--server"
          ? environment.values.ZITADEL_URL.value
          : undefined,
    });
  }

  /**
   * {@link environmentSelector} as arguments, for a result that reports its
   * follow-ups as argument lists too (`next_args`).
   */
  protected environmentSelectorArgs(): string[] {
    const { environment } = this;
    return [
      ...(environment.envFile !== undefined
        ? optionArgs("--env-file", environment.envFile)
        : environment.name.source === "--env"
          ? optionArgs("--env", environment.name.value)
          : []),
      ...(this.credentialFlag === undefined ? [] : optionArgs("--credential", this.credentialFlag)),
      ...(environment.values.ZITADEL_URL?.source === "--server"
        ? optionArgs("--server", environment.values.ZITADEL_URL.value)
        : []),
      ...(this.cwdFlag === undefined ? [] : optionArgs("--cwd", this.cwdFlag)),
    ];
  }

  /**
   * A `zitadel` command aimed at this run's project: `args` with this run's
   * {@link environmentSelector} appended, in the public `npx` form. Use it for
   * every suggestion a project command makes; a command that deliberately
   * leaves the project uses {@link BaseCommand.suggestUnscoped}.
   */
  protected suggest(args: string): SuggestedCommand {
    return projectCommand(args, this.environmentSelector(), this.meta.cliVersion);
  }

  /** A follow-up the framework suggests, such as a list's next page, aimed at this project. */
  protected override suggestFollowUp(args: string): SuggestedCommand {
    return this.suggest(args);
  }

  /**
   * The run again through {@link suggest}, which puts its selector back on.
   * A run that resolved no environment (an `auth-method` edit) has none to
   * put back, so it keeps the words as typed.
   */
  protected override retryCommand(words: readonly string[]): SuggestedCommand {
    if ((this.environment as Environment | undefined) === undefined) {
      return super.retryCommand(words);
    }
    const line = Cmd.of(words).without(ENVIRONMENT_SELECTOR_OPTIONS);
    return this.suggest(line.toString());
  }

  /**
   * Open the platform connection, authenticated with the credential this run
   * chose. It fails, naming the variable, when the server, the project or
   * every credential is missing.
   *
   * The credential is chosen once per run, in this order:
   *
   * 1. The command's secret when this run names it: from the process
   *    environment, `--env-file`, or the files of an environment the run
   *    chose. A CI build keeps acting as the project.
   * 2. Else the developer's sign-in to the server (`zitadel login`), when one
   *    is kept, refreshed when it expired.
   * 3. Else the secret setup stored for the development environment
   *    (`.env.local`, `.env.development.local`, `.env.development`, `.env`,
   *    `.zitadel/secret`).
   * 4. Else the secret is asked for on a terminal, or the run fails naming it
   *    and `zitadel login` as the other way in.
   *
   * `--credential project` takes the secret from wherever it resolves and
   * never the sign-in; `--credential login` takes the sign-in alone. Whichever
   * was chosen, a refusal of it is final: a sign-in the server refuses is not
   * retried with the secret, nor the reverse (`./credentials`).
   *
   * Which project and server the command is about is worth stating to a person,
   * but those lines share stdout with the result, so they are printed only on a
   * terminal: on a pipe the result travels alone, and `--json` silences them
   * either way. `quiet` is for a command whose own output is that summary.
   *
   * `verbatim` is for a caller that stores, compares or sends back what it
   * reads (see `SanitizeOptions`).
   * One connection is opened per set of options and shared by every caller,
   * a requirement that needs the project and the command's own `execute`
   * alike. `prompt: false` is for a best-effort probe that must never stop to ask
   * (or write `.env.<name>.local`): a missing value then fails as it would
   * non-interactively.
   */
  protected connect(options: ConnectOptions = {}): Promise<Connection> {
    // The options read for what they are, not in the order they were written,
    // so the same two asked for twice are one connection and not two clients,
    // two "Project/Server" lines and two credential prompts.
    const key = JSON.stringify(
      Object.fromEntries(
        Object.entries(options).sort(([one], [other]) => one.localeCompare(other)),
      ),
    );
    const already = this.connections.get(key);
    if (already !== undefined) {
      return already;
    }
    // A failed connection is forgotten rather than kept: a credential given
    // after the first attempt was refused would otherwise never be tried.
    const open = this.openConnection(options).catch((error: unknown) => {
      this.connections.delete(key);
      throw error;
    });
    this.connections.set(key, open);
    return open;
  }

  private async openConnection(options: ConnectOptions): Promise<Connection> {
    const { environment } = this;
    // Recorded before anything is required, so a run stopped for a missing
    // value still says whether it read an env file.
    this.recordTelemetry({ has_env_file: environment.envFile !== undefined });
    // On a terminal a missing value is prompted for and persisted to
    // `.env.<name>.local` (#1313); non-interactively each still throws, naming
    // the sources consulted, so a scripted run stays deterministic.
    // A dry run writes nothing, and an answer is persisted to a file, so it
    // never asks: a missing value fails it exactly as a scripted run.
    const ask = {
      cwd: this.meta.cwd,
      interactive: !this.meta.nonInteractive && !this.meta.dryRun && options.prompt !== false,
    };
    const server = await requireValueInteractive(environment, "ZITADEL_URL", ask);
    const projectId = await requireValueInteractive(environment, "ZITADEL_PROJECT_ID", ask);
    // A failed choice is forgotten, as a failed connection is, so a later
    // connection that may ask asks.
    this.choosing ??= this.chooseCredential(server, ask).catch((error: unknown) => {
      this.choosing = undefined;
      throw error;
    });
    const credential = await this.choosing;
    // Recorded once chosen, so it is the credential the run used, and the
    // envelope names it from here on, a failure's included.
    this.recordTelemetry({ credential: credential.used });
    this.meta = { ...this.meta, credential: credential.used };
    if (this.isOnScreen && !options.quiet) {
      consola.info(`Project   ${projectId}`);
      consola.info(`Server    ${server}`);
      if (credential.who !== undefined) {
        consola.info(`As        ${credential.who}`);
      }
    }
    return {
      client: createZitadelClient(
        { baseUrl: server, token: credential.token, signal: this.signal },
        { verbatim: options.verbatim },
      ),
      projectId,
      server,
      environment,
      credential: credential.used,
    };
  }

  /** The credential {@link connect} authenticates with, in the order it describes. */
  private async chooseCredential(
    server: string,
    ask: { cwd: string; interactive: boolean },
  ): Promise<Chosen> {
    const command = this.constructor as typeof EnvironmentCommand;
    const variable = CREDENTIALS[command.credential];
    const forced = this.credentialFlag;
    if (forced === "login" && !command.acceptsSignIn) {
      throw refusalError(NEVER_AS_YOU_REFUSAL, {
        command: (this.id ?? "").replaceAll(":", " "),
        variable,
      });
    }
    const named =
      this.environment.values[variable] !== undefined && !storedBySetup(this.environment, variable);
    const secretFirst =
      forced === "project" || !command.acceptsSignIn || (forced !== "login" && named);
    if (!secretFirst) {
      const signedIn = await signInAt(server, { env: this.env, signal: this.signal });
      if (signedIn !== undefined) {
        return { used: "login", token: signedIn.token, who: signedIn.who };
      }
      if (forced === "login") {
        throw refusalError(NOT_SIGNED_IN_REFUSAL, { server }, (next) => {
          return unscopedCommand(next, this.meta.cliVersion);
        });
      }
    }
    const token = await requireValueInteractive(this.environment, variable, {
      ...ask,
      ...(secretFirst
        ? {}
        : {
            alternative: `Or act as yourself: sign in with \`zitadel login --server ${server}\`.`,
          }),
    });
    return { used: command.credential, token };
  }
}

/**
 * A command that runs in a pull-request build and talks to the project with one
 * credential, never falling back to the other: a missing one fails and names
 * the variable. The `preview` command adds the `--origin`/`--ttl` flag bag
 * itself; `preview list` and `preview rm` extend this for the credential alone.
 * It never acts as the developer either: a pull-request build has no one
 * signed in, and the same command on a laptop must deploy as CI would.
 *
 * The reach the credential carries — the release/deployment/preview operations
 * these commands make — is granted and enforced by the server, not by the CLI:
 * the CLI only chooses which token to present.
 *
 * Which one that is, is {@link PREVIEW_CREDENTIAL}: the project secret for now,
 * because the server does not accept the narrower preview token yet (#1575).
 * Every message naming the variable derives it from there, so moving back to
 * `preview` is this one constant.
 */
export const PREVIEW_CREDENTIAL: CredentialKind = "project";

export abstract class PreviewCommand extends EnvironmentCommand {
  static override baseFlags = {
    ...EnvironmentCommand.baseFlags,
    credential: ignoredCredentialFlag,
  };

  static override credential: CredentialKind = PREVIEW_CREDENTIAL;

  static override acceptsSignIn = false;

  /**
   * Never prompts: a pull-request build has no one to ask, and a missing
   * value, the preview token above all, fails naming the variable rather
   * than being typed in and saved to `.env.<name>.local`.
   */
  protected override connect(options: ConnectOptions = {}): Promise<Connection> {
    return super.connect({ ...options, prompt: false });
  }
}
