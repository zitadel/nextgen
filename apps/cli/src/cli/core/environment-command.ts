import { createZitadelClient } from "@/lib/backend";
import type { Consent } from "@/lib/consent";
import {
  Environment,
  EnvironmentNameInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueUnboundError,
  type ServerAddresses,
} from "@/lib/environment";
import { resolveCwd } from "@/lib/paths";
import {
  LocalRuntime,
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRespondingError,
  LocalServerNotRunningError,
  LocalServerRecordMalformedError,
  LocalServerRecordUnreadableError,
} from "@/lib/server";
import { BaseCommand, type Facts, type MetaOptions } from "./base";
import { CREDENTIALS, type CredentialKind } from "./credentials";
import { environmentFlags } from "./environment-flags";
import { type Refusal, refusalError } from "./refusal";
import { byName } from "@/lib/names";
import type { Connection, ConnectOptions, GlobalOptions } from "./types";

export type { Connection } from "./types";

import { Runtime } from "@/lib/runtime";

/** How an environment named by its name and by a file is refused. */
const SOURCES_CONFLICT_REFUSAL = {
  message: "{message}",
  hint: "--env picks the .env.<name>.local files; --env-file names one file outright.",
} as const satisfies Refusal;

/** How an environment name that cannot be used in a path is refused. */
const NAME_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Pass a safe --env or set ZITADEL_ENV.",
} as const satisfies Refusal;

/** How a value set in no source is refused when its environment has no project at all. */
const VALUE_MISSING_UNBOUND_REFUSAL = {
  message: "{message}",
  next: ["{next}"],
} as const satisfies Refusal;

/** How a run is refused when no local server was started in the folder or a parent. */
const LOCAL_SERVER_NOT_RUNNING_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when the local server this folder started does not answer. */
const LOCAL_SERVER_NOT_RESPONDING_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "Run `zitadel start` to bring it back.",
  next: [
    {
      id: "start",
    },
  ],
} as const satisfies Refusal;

/** How a run is refused when the local server a parent folder started does not answer. */
const LOCAL_SERVER_NOT_RESPONDING_ELSEWHERE_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "It was started in another directory: run `zitadel start` there to bring it back.",
  next: ["{start}"],
} as const satisfies Refusal;

/** How a run is refused when the runtime record of this folder is not in the shape it is written in. */
const RECORD_MALFORMED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Run `zitadel reset --force`, then `zitadel start`.",
  next: ["{reset}", "{start}"],
} as const satisfies Refusal;

/** How a run is refused when the runtime record of this folder cannot be read. */
const RECORD_UNREADABLE_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Check that the runtime record and its directory are readable by you.",
} as const satisfies Refusal;

/**
 * A command that talks to a project. The server, the project and the
 * credential all come from the environment it runs in — `--env`,
 * `--env-file`, the process environment and the `.env` files, then
 * `.zitadel/secret` — so every such command resolves them the same way and
 * fails the same way when one is missing.
 *
 * Which credential it authenticates with is `static credential`; the project
 * secret unless a subclass says otherwise.
 */
export abstract class EnvironmentCommand extends BaseCommand {
  static override baseFlags = { ...BaseCommand.baseFlags, ...environmentFlags };

  static credential: CredentialKind = "project";

  private readonly connections = new Map<string, Promise<Connection>>();
  private credentialUsed: { credential: string; hasEnvFile: boolean } | undefined;

  /**
   * Which credential the run connected with, once it has tried one, and
   * whether an env file was named; never a token or a path.
   *
   * @returns The facts, with the layers below.
   */
  protected override describe(): Facts {
    return {
      ...super.describe(),
      credential: this.credentialUsed?.credential,
      has_env_file: this.credentialUsed?.hasEnvFile,
    };
  }

  /** What the invocation resolved to; set by {@link toMeta}. */
  protected environment!: Environment;

  /**
   * How a server address is read from a flag, an environment file or an answer.
   * A command that takes a server says; the mixin that makes one take it does.
   *
   * @returns What resolves, parses and normalises a server address.
   */
  protected abstract servers(): ServerAddresses;

  /**
   * Resolve the environment, then build the invocation context from its server.
   *
   * A missing server is not an error here: whether a command needs one is for
   * {@link connect} to say, so `zitadel env` can show an environment that
   * resolves to nothing. `options.source` stands in for `--server`, for the
   * commands that read the server from somewhere the chain does not know (the
   * local runtime metadata `status --server local` reads). A command that only
   * edits files in the project directory (`options.environment` is `false`)
   * resolves no environment: a stray ZITADEL_ENV must not stop it, and it names
   * no server or project.
   */
  protected override async toMeta(
    given: Record<string, unknown>,
    options: MetaOptions = {},
  ): Promise<GlobalOptions> {
    const flags = byName(given);
    const text = (value: unknown): string | undefined => {
      return typeof value === "string" ? value : undefined;
    };
    if (options.environment === false) {
      return super.toMeta(given, { source: options.source });
    }
    try {
      this.environment = await Environment.resolve({
        servers: this.servers(),
        cwd: resolveCwd(text(flags.cwd)),
        env: process.env,
        serverFlag: options.source ?? text(flags.server),
        envName: text(flags.env),
        envFile: text(flags.envFile),
      });
    } catch (error) {
      if (error instanceof EnvironmentSourcesConflictError) {
        throw refusalError(SOURCES_CONFLICT_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof EnvironmentNameInvalidError) {
        throw refusalError(NAME_INVALID_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof LocalServerNotRunningError) {
        throw refusalError(LOCAL_SERVER_NOT_RUNNING_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof LocalServerNotRespondingError) {
        throw refusalError(LOCAL_SERVER_NOT_RESPONDING_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof LocalServerNotRespondingElsewhereError) {
        throw refusalError(
          LOCAL_SERVER_NOT_RESPONDING_ELSEWHERE_REFUSAL,
          {
            ...error,
            message: error.message,
          },
          {
            start: {
              id: "start",
              flags: {
                cwd: error.directory,
              },
            },
          },
        );
      }
      if (error instanceof LocalServerRecordMalformedError) {
        const holder =
          (await LocalRuntime.findUpward(resolveCwd(text(flags.cwd)), LocalRuntime.FILE).catch(
            (error: unknown) => {
              if (error instanceof LocalServerRecordUnreadableError) {
                return undefined;
              }
              throw error;
            },
          )) ?? resolveCwd(text(flags.cwd));
        const elsewhere =
          holder === resolveCwd(text(flags.cwd))
            ? {}
            : {
                cwd: holder,
              };
        throw refusalError(
          RECORD_MALFORMED_REFUSAL,
          {
            ...error,
            message: error.message,
          },
          {
            reset: {
              id: "reset",
              flags: {
                force: true,
                ...elsewhere,
              },
            },
            start: {
              id: "start",
              flags: elsewhere,
            },
          },
        );
      }
      if (error instanceof LocalServerRecordUnreadableError) {
        throw refusalError(RECORD_UNREADABLE_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }

    return super.toMeta(given, {
      source: this.environment.values.ZITADEL_URL?.value ?? "",
    });
  }

  /**
   * The backend service for the project this run is about, on the connection
   * {@link connect} opens, or on the client a {@link Consent} unlocks for a
   * service that changes something destructively.
   *
   * @param Service - The service class, built from the client and the project's id.
   * @param consent - The consent that unlocks the client, for a destructive change.
   * @returns The service.
   */
  protected async service<Service>(
    Service: new (client: Connection["client"], projectId: string) => Service,
    consent?: Consent,
  ): Promise<Service> {
    const { client, projectId } = await this.connect();

    return new Service(consent === undefined ? client : consent.unlock(client), projectId);
  }

  /**
   * The project this run is about and the server it is on, as a question names
   * them: `project prj_1 on example.com`.
   *
   * @returns The phrase.
   */
  protected async projectOnServer(): Promise<string> {
    const { projectId, server } = await this.connect();

    return `project ${projectId} on ${server.replace(/^https?:\/\//, "")}`;
  }

  /**
   * Open the platform connection, authenticated with this command's
   * credential. It fails, naming the variable, when the server, the project or
   * the credential is missing.
   *
   * Which project and server the command is about is recorded for its ending
   * to state once, at its foot; nothing is printed here.
   *
   * One connection is opened per set of options and shared by every caller,
   * a requirement that needs the project and the command's own `execute`
   * alike. `prompt: false` is for a best-effort probe that must never stop to ask
   * (or write `.env.<name>.local`): a missing value then fails as it would
   * non-interactively.
   *
   * The options are keyed for what they are, not in the order they were
   * written, so the same two asked for twice are one connection and not two
   * clients, two "Project/Server" lines and two credential prompts. A failed
   * connection is forgotten rather than kept: a credential given after the
   * first attempt was refused would otherwise never be tried.
   */
  protected async connect(options: ConnectOptions = {}): Promise<Connection> {
    const key = JSON.stringify(
      Object.fromEntries(
        Object.entries(options).sort(([one], [other]) => {
          return one.localeCompare(other);
        }),
      ),
    );
    const already = this.connections.get(key);
    if (already !== undefined) {
      return already;
    }
    const open = this.openConnection(options);
    this.connections.set(key, open);
    try {
      await open;
    } catch (error) {
      this.connections.delete(key);
      throw error;
    }

    return open;
  }

  /**
   * Resolves the server, the project and the credential, and builds the
   * connection from them. The credential is recorded in telemetry before
   * anything is required, so a run stopped for a missing value still says which
   * credential it was after.
   *
   * On a terminal a missing value is prompted for and persisted to
   * `.env.<name>.local`; non-interactively each still throws, naming the
   * sources consulted, so a scripted run stays deterministic. A dry run writes
   * nothing, and an answer is persisted to a file, so it never asks: a missing
   * value fails it exactly as a scripted run.
   *
   * @param options - How to connect, as {@link connect} takes them.
   * @returns The open connection.
   */
  private async openConnection(options: ConnectOptions): Promise<Connection> {
    const { credential } = this.constructor as typeof EnvironmentCommand;
    const { environment } = this;
    // Kept before anything is required, so a run stopped for a missing value
    // still says which credential it was after.
    this.credentialUsed = { credential, hasEnvFile: environment.envFile !== undefined };
    // On a terminal a missing value is prompted for and persisted to
    // `.env.<name>.local`; non-interactively each still throws, naming
    // the sources consulted, so a scripted run stays deterministic.
    // A dry run writes nothing, and an answer is persisted to a file, so it
    // never asks: a missing value fails it exactly as a scripted run.
    const ask = {
      cwd: this.cwd,
      interactive: !this.nonInteractive && !this.meta.dryRun && options.prompt !== false,
      ask: this.ui.questions(),
    };
    try {
      const server = await environment.requireInteractive("ZITADEL_URL", ask);
      const projectId = await environment.requireInteractive("ZITADEL_PROJECT_ID", ask);
      const token = await environment.requireInteractive(CREDENTIALS[credential], ask);
      this.ui.ranAgainst(projectId, server);

      return {
        client: createZitadelClient({
          userAgent: Runtime.current().userAgent(),
          baseUrl: server,
          token,
          signal: this.signal,
          ...(options.timeoutMs === undefined
            ? {}
            : {
                timeoutMs: options.timeoutMs,
              }),
        }),
        projectId,
        server,
        environment,
      };
    } catch (error) {
      if (error instanceof EnvironmentValueUnboundError) {
        // Run in the directory this run addressed, which need not be the
        // shell's: `setup` and `env add` both write their files there.
        const elsewhere =
          this.cwd === process.cwd()
            ? {}
            : {
                cwd: this.cwd,
              };
        throw refusalError(
          VALUE_MISSING_UNBOUND_REFUSAL,
          {
            ...error,
            message: error.message,
          },
          {
            next:
              environment.name.value === "development"
                ? {
                    id: "setup",
                    flags: elsewhere,
                  }
                : {
                    id: "env:add",
                    args: {
                      name: environment.name.value,
                    },
                    flags: elsewhere,
                  },
          },
        );
      }
      throw error;
    }
  }
}

/**
 * A command that runs in a pull-request build and talks to the project with one
 * credential, never falling back to the other: a missing one fails and names
 * the variable. The `preview` command adds the `--origin`/`--ttl` flag bag
 * itself; `preview list` and `preview rm` extend this for the credential alone.
 *
 * The reach the credential carries — the release/deployment/preview operations
 * these commands make — is granted and enforced by the server, not by the CLI:
 * the CLI only chooses which token to present.
 *
 * Which one that is, is {@link PREVIEW_CREDENTIAL}: the project secret for now,
 * because the server does not accept the narrower preview token yet.
 * Every message naming the variable derives it from there, so moving back to
 * `preview` is this one constant.
 */
export const PREVIEW_CREDENTIAL: CredentialKind = "project";

export abstract class PreviewCommand extends EnvironmentCommand {
  static override credential: CredentialKind = PREVIEW_CREDENTIAL;

  /**
   * Never prompts: a pull-request build has no one to ask, and a missing
   * value, the preview token above all, fails naming the variable rather
   * than being typed in and saved to `.env.<name>.local`.
   */
  protected override connect(options: ConnectOptions = {}): Promise<Connection> {
    return super.connect({ ...options, prompt: false });
  }
}
