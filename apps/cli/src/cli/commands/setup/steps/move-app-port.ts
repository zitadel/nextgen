import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { callbackUriFor } from "@/lib/idp";
import { createOrca, issuerFromPort, type Orca } from "@/lib/orca";
import {
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
  writeZitadelSecret,
} from "@/lib/project";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { relativeDisplayPath as relativeDisplay } from "@/cli/commands/setup/shared";

import type { CommandResult } from "@/lib/oclif";
import { EndStep } from "@/lib/wizard";

import { loadPatchContext } from "@/cli/commands/doctor/patch-context";
import {
  createZitadelClient,
  DeploymentService,
  OriginService,
  type ZitadelClient,
} from "@/lib/backend";
import { type Consent, type Gate, isRefusal } from "@/lib/consent";
import { errorMessage, isCancellation, toZitadelError, ZitadelError } from "@/lib/errors";
import { portFromIssuer } from "@/lib/orca/detectors/port";
import { replaceOrigin } from "@/lib/orca/patchers/rule/dev-port-move";
import type { PatchResult } from "@/lib/orca/patchers/types";
import { readScaffoldManifest } from "@/lib/scaffold-manifest";
import { updateScaffold } from "@/lib/sync/state";
import { userAgent } from "@/lib/user-agent";
import { DiskStore, ZitadelConfig } from "@/lib/zitadel";

/**
 * The env file setup writes for the CLI's own commands. Every command setup
 * suggests that resolves an environment is pinned to it: `variable set` and the
 * like resolve the project and server from the environment, where the process
 * environment outranks the `.env` files, so a bare retry in a shell holding
 * production values would publish to the wrong project. `--env-file` outranks
 * the process environment (unlike `--env`), so it forces the project setup
 * created.
 */
export const RECOVERY_ENV_FILE = ".env.development.local";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "preflight">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  | "cliVersion"
  | "consent"
  | "cwd"
  | "dryRun"
  | "realRun"
  | "recoverAt"
  | "signal"
  | "suggest"
  | "ui"
>;

/**
 * Ends the run for an app already set up that was asked for another port, which
 * is how it moves: there is nothing left to scaffold.
 */
export class MoveAppPort extends EndStep<"moveDevPort", CommandResult, Needs> {
  readonly key = "moveDevPort";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Whether the directory is set up and an explicit `--dev-port` came with it.
   *
   * @param needs - The flags and what was settled before the first step.
   * @param _services - What the command provides.
   * @returns Whether to end here.
   */
  when(needs: Needs): boolean {
    return needs.preflight.configured && needs.flags.devPort !== undefined;
  }

  /**
   * Move the app to the new port.
   *
   * @remarks
   * `setup --dev-port <n>` on an app setup already patched: moves the app to
   * the new port (see {@link moveDevPort}) instead of skipping the directory.
   * The spinner ends before the consent question, which it would draw over. A
   * step ends once, so a failure says nothing more when `filesMoved` ended it.
   *
   * The recovery is pinned to the project just moved, as the other recoveries
   * are: its env file, or the server the move used for a project setup gave
   * none, never what the shell has exported. The cleanup is not setup again:
   * the app is on the new port by now, so a rerun moves nothing and never
   * reaches the old origin. The new origin serves nothing until a deployment
   * names it, hence the deploy warning.
   *
   * @param needs - The flags and what was settled before the first step.
   * @param this.deps - What the command provides.
   * @returns The result.
   */
  async run(needs: Needs): Promise<CommandResult> {
    const config = await readZitadelConfig(this.deps.cwd);
    const server = readProjectServer(config);
    const moving = this.deps.ui.begin(
      `Moving the app to ${issuerFromPort(needs.flags.devPort ?? 0)}${this.deps.dryRun ? " (dry run)" : ""}`,
    );
    const move = await moveDevPort({
      cwd: this.deps.cwd,
      devPort: needs.flags.devPort ?? 0,
      source: server,
      orca: createOrca(),
      cliVersion: this.deps.cliVersion,
      dryRun: this.deps.dryRun,
      signal: this.deps.signal,
      consent: (gate) => {
        return this.deps.consent(gate);
      },
      filesMoved: (moved) => {
        for (const file of moved.result.filesWritten) {
          moving.detail(
            `${this.deps.dryRun ? "Would update" : "Updated"} ${escapeControlCharacters(relativeDisplay(this.deps.cwd, file))}`,
          );
        }
        if (moved.previousIssuer === moved.issuer) {
          moving.done(`Already on ${moved.issuer}`);
        } else {
          moving.done(
            `${this.deps.dryRun ? "Would move" : "Moved"} from ${escapeControlCharacters(moved.previousIssuer)} to ${moved.issuer}`,
          );
        }
      },
    }).catch((error: unknown) => {
      moving.fail();
      throw error;
    });
    if (
      !(await access(join(this.deps.cwd, RECOVERY_ENV_FILE)).then(
        () => {
          return true;
        },
        () => {
          return false;
        },
      ))
    ) {
      this.deps.recoverAt(server);
    }
    const cleanup =
      move.refused && move.staleOrigin !== undefined
        ? this.deps.suggest({
            id: "origin:rm",
            args: { pattern: move.staleOrigin },
            flags: { force: true },
          })
        : undefined;
    const deploy =
      move.undeployed === undefined
        ? undefined
        : this.deps.suggest({
            id: "deploy",
            flags: { message: WHAT_CHANGED },
          });
    if (deploy !== undefined) {
      reportWarning(
        `${move.issuer} serves nothing until the next deploy: ${move.undeployed}. Run ${deploy}.`,
      );
    }
    if (move.staleOrigin !== undefined) {
      reportWarning(
        `${escapeControlCharacters(move.staleOrigin)} is still among the project's origins; it admits a port nothing serves any more.${cleanup === undefined ? "" : ` Remove it with ${cleanup}.`}`,
      );
    }
    for (const slug of move.ssoProviders) {
      reportWarning(
        `Social sign-in with ${slug} redirects to the old port: add ${callbackUriFor(move.issuer, slug)} as a redirect URI at the provider.`,
      );
    }
    const moved = move.previousIssuer !== move.issuer;
    const headline = moved
      ? `${this.deps.dryRun ? "Would move" : "Moved"} the app to ${move.issuer}`
      : `The app is already on ${move.issuer}`;
    const title = this.deps.dryRun ? `${headline} (dry run)` : headline;

    return {
      status: "ok",
      data: {
        title,
        ...(this.deps.dryRun ? { dry_run: true } : {}),
        moved,
        previous_issuer: move.previousIssuer,
        issuer: move.issuer,
        dev_port: needs.flags.devPort ?? 0,
        files_written: move.result.filesWritten.map((file) => {
          return relativeDisplay(this.deps.cwd, file);
        }),
        deployment_id: move.deploymentId ?? null,
      },
      summary: {
        title,
        sections: [],
        boxed: true,
      },
      next: {
        actions: this.deps.dryRun ? [] : [`Restart the dev server and open ${move.issuer}/login.`],
        ...(deploy === undefined && cleanup === undefined && !this.deps.dryRun
          ? {}
          : {
              commands: [
                deploy,
                cleanup,
                this.deps.dryRun ? await this.deps.realRun() : undefined,
              ].filter((command) => {
                return command !== undefined;
              }),
            }),
      },
    };
  }
}

/** What {@link moveDevPort} changed. */
export type DevPortMove = Readonly<{
  previousIssuer: string;
  issuer: string;
  result: PatchResult;
  /** The provider slugs whose redirect URI still names the previous port. */
  ssoProviders: ReadonlyArray<string>;
  /** Set when the previous origin was left among the project's origins. */
  staleOrigin?: string;
  /** Set when it was left for want of `--force`, rather than because removing it failed. */
  refused?: true;
  /** The deployment that made the new origin serve the release the old one ran. */
  deploymentId?: string;
  /** Why the new origin serves nothing yet, when the move could not deploy to it. */
  undeployed?: string;
}>;

/**
 * Moves an app setup already patched to another dev port, in one step: the
 * project's origin on the server, then the dev script or dev-server config,
 * `ZITADEL_ISSUER` in `.env.local`, `zitadel.json`, `.zitadel/secret` and the
 * README/AGENTS.md guidance. Backs `setup --dev-port` on an app that already
 * has a `zitadel.json`, which otherwise has nothing left to set up.
 *
 * The new origin is added before any file changes, so a server that refuses
 * leaves the app as it was. A primary origin serves nothing until a deployment
 * names it, so the release the old port ran is then deployed again, landing on
 * the new port too; a deploy that cannot is reported, not thrown, as the files
 * have moved by then. The previous origin is removed last, and only with
 * `consent`: one that is refused, declined or fails is reported, not thrown,
 * because the app already works on the new port and the old pattern only
 * admits a port nothing serves any more.
 *
 * @remarks
 * The configuration is read before anything changes, so one that cannot be read
 * stops the move rather than leaving it half made. The app's own origin is
 * primary, so the move rewrites that list; an older secret that still carries
 * the issuer as a preview pattern is rewritten too, so the stale URL is not
 * left behind either way. A refusal for want of `--force` leaves the origin
 * behind and says so; anything else the request for consent throws (Ctrl-C, a
 * bug) stops the run.
 *
 * @param opts - Where, to which port, and how to ask and report.
 * @returns What the move changed and what it left behind.
 * @throws {ZitadelError} When the server refuses the new origin.
 */
export async function moveDevPort(opts: {
  cwd: string;
  devPort: number;
  source: string;
  orca: Orca;
  cliVersion: string;
  dryRun: boolean;
  /** Aborts the requests, as Ctrl-C does for the command that sent them. */
  signal: AbortSignal;
  /** Asks to remove the previous origin; the command's own confirmation. */
  consent: (gate: Gate) => Promise<Consent | undefined>;
  /** Told once the files have moved, before the consent is asked. */
  filesMoved?: (moved: Pick<DevPortMove, "previousIssuer" | "issuer" | "result">) => void;
}): Promise<DevPortMove> {
  const { cwd, devPort, source, orca, cliVersion, dryRun, signal } = opts;
  const context = await loadPatchContext(cwd, orca, cliVersion);
  const previousIssuer = context.issuer;
  const issuer = issuerFromPort(devPort);
  const secret = await readZitadelSecret(cwd);
  const moving = previousIssuer !== issuer;
  const ssoProviders = moving ? await connectionSlugs(cwd) : [];

  const client = createZitadelClient({
    userAgent: userAgent(),
    baseUrl: source,
    token: secret.project_secret,
    signal,
  });
  if (!dryRun) {
    const originService = new OriginService(client, secret.project_id);
    try {
      await originService.add(issuer, "primary");
    } catch (error) {
      const normalized = toZitadelError(error);
      throw new ZitadelError(normalized.code, `Could not allow ${issuer} for this project`, {
        hint: `${normalized.message}. Nothing was changed; start the server this app uses (${source}) and retry.`,
        details: { original: normalized.details },
      });
    }
  }

  const ctx = {
    ...context,
    issuer,
    framework: {
      ...context.framework,
      devPort,
      url: issuer,
    },
  };
  const patcher = orca.patcherFor(ctx.framework.id);
  const result = await patcher.moveDevPort(ctx, previousIssuer, {
    cwd,
    dryRun,
    force: false,
  });

  if (!dryRun) {
    const rewrite = (patterns: string[]): string[] => {
      return replaceOrigin(patterns, previousIssuer, issuer).filter((pattern) => {
        return typeof pattern === "string";
      });
    };
    await writeZitadelSecret(cwd, {
      ...secret,
      primary_origins: rewrite(secret.primary_origins),
      preview_origins: rewrite(secret.preview_origins),
    });
    const manifest = await readScaffoldManifest(cwd);
    if (manifest !== undefined) {
      await updateScaffold(cwd, {
        ...manifest,
        dev_port: devPort,
      });
    }
  }
  const served =
    dryRun || !moving ? {} : await serveNewOrigin(client, secret.project_id, issuer, devPort);
  opts.filesMoved?.({
    previousIssuer,
    issuer,
    result,
  });
  const replacing = !dryRun && moving && portFromIssuer(previousIssuer) !== undefined;
  const consent = replacing
    ? await opts
        .consent({
          verb: "replace",
          name: `remove ${previousIssuer} from the project's origins`,
          message: `Remove ${previousIssuer}, the app's previous origin, from project ${secret.project_id} on ${source.replace(/^https?:\/\//, "")}, now that ${issuer} replaces it?`,
        })
        .catch((error: unknown) => {
          if (isRefusal(error)) {
            return "refused" as const;
          }
          throw error;
        })
    : undefined;
  const originService =
    consent === undefined || consent === "refused"
      ? undefined
      : new OriginService(consent.unlock(client), secret.project_id);
  const staleOrigin = !replacing
    ? undefined
    : originService === undefined
      ? previousIssuer
      : await originService.remove(previousIssuer).then(
          () => {
            return undefined;
          },
          (error: unknown) => {
            if (isCancellation(error)) {
              throw error;
            }

            return previousIssuer;
          },
        );

  return {
    previousIssuer,
    issuer,
    result,
    ssoProviders,
    ...(staleOrigin === undefined ? {} : { staleOrigin }),
    ...(consent === "refused" ? { refused: true as const } : {}),
    ...served,
  };
}

/**
 * Deploys the project's newest primary release again so `issuer`, a primary
 * origin added since, serves it too: the deployment it made, or why the new
 * origin serves nothing yet. Only a cancellation is thrown.
 *
 * @param client - The client of the project's server.
 * @param projectId - The project.
 * @param issuer - The origin added since.
 * @param devPort - The port the app moved to.
 * @returns The deployment it made, or why there is none.
 * @throws The cancellation, when the run was interrupted.
 */
async function serveNewOrigin(
  client: ZitadelClient,
  projectId: string,
  issuer: string,
  devPort: number,
): Promise<Pick<DevPortMove, "deploymentId" | "undeployed">> {
  const deployments = new DeploymentService(client, projectId);
  try {
    const extended = await deployments.extendPrimary(issuer, `Moved the dev port to ${devPort}`);
    switch (extended.outcome) {
      case "deployed": {
        return {
          deploymentId: extended.deployment.id,
        };
      }
      case "unchanged": {
        return {};
      }
      case "none": {
        return {
          undeployed: "nothing is deployed to the project yet",
        };
      }
      case "raced": {
        return {
          undeployed: "another deploy landed while the app moved",
        };
      }
      case "revoked": {
        return {
          undeployed: "the release the previous port ran is revoked",
        };
      }
    }
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return {
      undeployed: `deploying to it failed: ${errorMessage(error)}`,
    };
  }
}

/**
 * The names of the project's connections, whose redirect URIs name the dev
 * port.
 *
 * @remarks
 * A connection file its contract refuses is still a provider whose redirect
 * URI names the port, so it is listed by its file name beside the valid ones.
 *
 * @param cwd - The project root.
 * @returns Each connection's name, in path order.
 * @throws The error the configuration could not be read with.
 */
async function connectionSlugs(cwd: string): Promise<readonly string[]> {
  const config = await ZitadelConfig.loadKinds(new DiskStore(cwd), ["connections"]);
  const connections = [
    ...config.connections.all.map((connection) => {
      return {
        path: connection.path,
        name: connection.slug,
      };
    }),
    ...config.broken
      .filter((file) => {
        return file.kind === "connection";
      })
      .map((file) => {
        return {
          path: file.path,
          name: basename(file.path, ".json"),
        };
      }),
  ];
  return [...connections]
    .sort((left, right) => {
      return left.path.localeCompare(right.path);
    })
    .map((connection) => {
      return connection.name;
    });
}
