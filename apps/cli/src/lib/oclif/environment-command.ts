import { createZitadelClient } from "@/lib/backend";
import { type Environment, requireValueInteractive, resolveEnvironment } from "@/lib/environment";
import { resolveCwd } from "@/lib/paths";
import { BaseCommand, type MetaOptions } from "./base";
import { CREDENTIALS, type CredentialKind } from "./credentials";
import { environmentFlags } from "./environment-flags";
import { byName } from "@/lib/names";
import type { Connection, ConnectOptions, GlobalOptions } from "./types";

export type { Connection } from "./types";

import type { Scope } from "@/lib/suggestion";
import { userAgent } from "@/lib/user-agent";

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

  /** What the invocation resolved to; set by {@link toMeta}. */
  protected environment!: Environment;

  /** `--cwd` as typed, reproduced by {@link scope}. */
  private cwdFlag: string | undefined;

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
    const text = (value: unknown): string | undefined => {
      return typeof value === "string" ? value : undefined;
    };
    this.cwdFlag = text(flags.cwd);
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
   * The run's scope, with how it chose its environment: only what was passed on
   * the command line, since a name that came from `ZITADEL_ENV` or a platform
   * signal needs none — the next run in the same environment inherits it. A
   * suggested command must resolve the same server, project and credential this
   * run did; without these it would fall back to the default environment and
   * quietly target the wrong project. A run that resolved no environment has
   * only its directory to put back.
   *
   * @returns The scope.
   */
  protected override scope(): Scope {
    if ((this.environment as Environment | undefined) === undefined) {
      return super.scope();
    }
    const { environment } = this;
    const server = environment.values.ZITADEL_URL;

    return {
      ...(this.cwdFlag === undefined ? {} : { cwd: this.cwdFlag }),
      ...(environment.envFile === undefined ? {} : { envFile: environment.envFile }),
      ...(environment.envFile === undefined && environment.name.source === "--env"
        ? { env: environment.name.value }
        : {}),
      ...(server?.source === "--server" ? { server: server.value } : {}),
    };
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
   */
  protected connect(options: ConnectOptions = {}): Promise<Connection> {
    // The options read for what they are, not in the order they were written,
    // so the same two asked for twice are one connection and not two clients,
    // two "Project/Server" lines and two credential prompts.
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
    const { credential } = this.constructor as typeof EnvironmentCommand;
    const { environment } = this;
    // Recorded before anything is required, so a run stopped for a missing
    // value still says which credential it was after.
    this.recordTelemetry({ credential, has_env_file: environment.envFile !== undefined });
    // On a terminal a missing value is prompted for and persisted to
    // `.env.<name>.local`; non-interactively each still throws, naming
    // the sources consulted, so a scripted run stays deterministic.
    // A dry run writes nothing, and an answer is persisted to a file, so it
    // never asks: a missing value fails it exactly as a scripted run.
    const ask = {
      cwd: this.cwd,
      interactive: !this.nonInteractive && !this.dryRun && options.prompt !== false,
      ask: this.ui.questions(),
    };
    const server = await requireValueInteractive(environment, "ZITADEL_URL", ask);
    const projectId = await requireValueInteractive(environment, "ZITADEL_PROJECT_ID", ask);
    const token = await requireValueInteractive(environment, CREDENTIALS[credential], ask);
    this.ui.ranAgainst(projectId, server);

    return {
      client: createZitadelClient({
        userAgent: userAgent(),
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
