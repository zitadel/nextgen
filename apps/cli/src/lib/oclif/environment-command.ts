import { consola } from "consola";

import { createZitadelClient, type ZitadelClient } from "../api-client";
import { type Environment, requireValueInteractive, resolveEnvironment } from "../environment";
import { resolveCwd } from "../paths";
import { BaseCommand } from "./base";
import { CREDENTIALS, type CredentialKind } from "./credentials";
import { environmentFlags, environmentSelectorSuffix } from "./environment-flags";
import type { GlobalOptions } from "./types";

/** The platform connection {@link EnvironmentCommand.connect} opens. */
export type Connection = Readonly<{
  client: ZitadelClient;
  projectId: string;
  server: string;
  environment: Environment;
}>;

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

  /** What the invocation resolved to; set by {@link toMeta}. */
  protected environment!: Environment;

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
    flags: Record<string, unknown>,
    options: { resolveServer?: boolean; source?: string } = {},
  ): Promise<GlobalOptions> {
    const text = (value: unknown): string | undefined =>
      typeof value === "string" ? value : undefined;
    this.environment = await resolveEnvironment({
      cwd: resolveCwd(text(flags.cwd)),
      env: process.env,
      serverFlag: options.source ?? text(flags.server),
      envName: text(flags.env),
      envFile: text(flags["env-file"]),
    });
    return super.toMeta(flags, {
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
  protected environmentSelector(): string {
    const { environment } = this;
    return environmentSelectorSuffix({
      envFile: environment.envFile,
      envName: environment.name.source === "--env" ? environment.name.value : undefined,
      server:
        environment.values.ZITADEL_URL?.source === "--server"
          ? environment.values.ZITADEL_URL.value
          : undefined,
    });
  }

  /**
   * Open the platform connection, authenticated with this command's
   * credential. It fails, naming the variable, when the server, the project or
   * the credential is missing.
   *
   * Which project and server the command is about is worth stating to a person,
   * but those lines share stdout with the result, so they are printed only on a
   * terminal: on a pipe the result travels alone, and `--json` silences them
   * either way. `quiet` is for a command whose own output is that summary.
   *
   * `verbatim` is for a caller that stores or compares what it reads (see
   * `SanitizeOptions`).
   */
  protected async connect(
    options: { verbatim?: boolean; quiet?: boolean } = {},
  ): Promise<Connection> {
    const { credential } = this.constructor as typeof EnvironmentCommand;
    const { environment } = this;
    // Recorded before anything is required, so a run stopped for a missing
    // value still says which credential it was after.
    this.recordTelemetry({ credential, has_env_file: environment.envFile !== undefined });
    // On a terminal a missing value is prompted for and persisted to
    // `.env.<name>.local` (#1313); non-interactively each still throws, naming
    // the sources consulted, so a scripted run stays deterministic.
    const ask = { cwd: this.meta.cwd, interactive: !this.meta.nonInteractive };
    const server = await requireValueInteractive(environment, "ZITADEL_URL", ask);
    const projectId = await requireValueInteractive(environment, "ZITADEL_PROJECT_ID", ask);
    const token = await requireValueInteractive(environment, CREDENTIALS[credential], ask);
    if (process.stdout.isTTY && !options.quiet) {
      consola.info(`Project   ${projectId}`);
      consola.info(`Server    ${server}`);
    }
    return {
      client: createZitadelClient({ baseUrl: server, token }, { verbatim: options.verbatim }),
      projectId,
      server,
      environment,
    };
  }
}

/**
 * A command that runs in a pull-request build and talks to the project with the
 * narrower preview credential ({@link CREDENTIALS.preview}, read from
 * `ZITADEL_PREVIEW_TOKEN`). It never falls back to the project secret, so a
 * missing preview token fails and names the variable. The `preview` command
 * adds the `--origin`/`--ttl` flag bag itself; `preview list` and `preview rm`
 * extend this for the credential alone.
 *
 * The reach the preview credential carries — the release/deployment/preview
 * operations these commands make — is granted and enforced by the server, not
 * by the CLI: the CLI only chooses which token to present. Wiring the server's
 * preview-deploy authorization to grant exactly those scopes is backend work
 * on `@zitadel/server`, tracked there.
 */
export abstract class PreviewCommand extends EnvironmentCommand {
  static override credential: CredentialKind = "preview";
}
