import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { callbackUriFor } from "@/lib/idp";
import { createOrca, issuerFromPort } from "@/lib/orca";
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
import { createZitadelClient, DeploymentService, OriginService } from "@/lib/backend";
import { isRefusal } from "@/lib/consent";
import { errorMessage, isCancellation, toZitadelError, ZitadelError } from "@/lib/errors";
import { portFromIssuer } from "@/lib/orca/detectors/port";
import { replaceOrigin } from "@/lib/orca/patchers/rule/dev-port-move";
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
   * `setup --dev-port <n>` on an app setup already patched moves the app to the new port instead
   * of skipping the directory: the project's origin on the server, then the dev script or
   * dev-server config, `ZITADEL_ISSUER` in `.env.local`, `zitadel.json`, `.zitadel/secret` and the
   * README/AGENTS.md guidance.
   *
   * The new origin is added before any file changes, so a server that refuses leaves the app as it
   * was. A primary origin serves nothing until a deployment names it, so the release the old port
   * ran is then deployed again, landing on the new port too; a deploy that cannot is reported, not
   * thrown, as the files have moved by then. The previous origin is removed last, and only with
   * consent: one that is refused, declined or fails is reported, not thrown, because the app
   * already works on the new port and the old pattern only admits a port nothing serves any more.
   *
   * The configuration is read before anything changes, so one that cannot be read stops the move
   * rather than leaving it half made. The app's own origin is primary, so the move rewrites that
   * list; an older secret that still carries the issuer as a preview pattern is rewritten too, so
   * the stale URL is not left behind either way. A refusal for want of `--force` leaves the origin
   * behind and says so; anything else the request for consent throws (Ctrl-C, a bug) stops the
   * run. A connection file its contract refuses is still a provider whose redirect URI names the
   * port, so it is listed by its file name beside the valid ones, in path order.
   *
   * The spinner ends before the consent question, which it would draw over. A step ends once, so a
   * failure says nothing more when the move already ended it.
   *
   * The recovery is pinned to the project just moved, as the other recoveries are: its env file, or
   * the server the move used for a project setup gave none, never what the shell has exported. The
   * cleanup is not setup again: the app is on the new port by now, so a rerun moves nothing and
   * never reaches the old origin. The new origin serves nothing until a deployment names it, hence
   * the deploy warning.
   *
   * @param needs - The flags and what was settled before the first step.
   * @returns The result.
   * @throws {ZitadelError} When the server refuses the new origin.
   */
  async run(needs: Needs): Promise<CommandResult> {
    const devPort = needs.flags.devPort ?? 0;
    const source = readProjectServer(await readZitadelConfig(this.deps.cwd));
    const moving = this.deps.ui.begin(
      `Moving the app to ${issuerFromPort(devPort)}${this.deps.dryRun ? " (dry run)" : ""}`,
    );
    try {
      const orca = createOrca();
      const context = await loadPatchContext(this.deps.cwd, orca, this.deps.cliVersion);
      const previousIssuer = context.issuer;
      const issuer = issuerFromPort(devPort);
      const secret = await readZitadelSecret(this.deps.cwd);
      const moved = previousIssuer !== issuer;
      const ssoProviders = moved
        ? await ZitadelConfig.loadKinds(new DiskStore(this.deps.cwd), ["connections"]).then(
            (config) => {
              return [
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
              ]
                .sort((left, right) => {
                  return left.path.localeCompare(right.path);
                })
                .map((connection) => {
                  return connection.name;
                });
            },
          )
        : [];
      const client = createZitadelClient({
        userAgent: userAgent(),
        baseUrl: source,
        token: secret.project_secret,
        signal: this.deps.signal,
      });
      if (!this.deps.dryRun) {
        try {
          await new OriginService(client, secret.project_id).add(issuer, "primary");
        } catch (error) {
          const normalized = toZitadelError(error);
          throw new ZitadelError(normalized.code, `Could not allow ${issuer} for this project`, {
            hint: `${normalized.message}. Nothing was changed; start the server this app uses (${source}) and retry.`,
            details: { original: normalized.details },
          });
        }
      }
      const result = await orca.patcherFor(context.framework.id).moveDevPort(
        {
          ...context,
          issuer,
          framework: {
            ...context.framework,
            devPort,
            url: issuer,
          },
        },
        previousIssuer,
        {
          cwd: this.deps.cwd,
          dryRun: this.deps.dryRun,
          force: false,
        },
      );
      if (!this.deps.dryRun) {
        const rewrite = (patterns: ReadonlyArray<string>): string[] => {
          return replaceOrigin(patterns, previousIssuer, issuer).filter((pattern) => {
            return typeof pattern === "string";
          });
        };
        await writeZitadelSecret(this.deps.cwd, {
          ...secret,
          primary_origins: rewrite(secret.primary_origins),
          preview_origins: rewrite(secret.preview_origins),
        });
        const manifest = await readScaffoldManifest(this.deps.cwd);
        if (manifest !== undefined) {
          await updateScaffold(this.deps.cwd, {
            ...manifest,
            dev_port: devPort,
          });
        }
      }
      const served: Readonly<{
        deploymentId?: string;
        undeployed?: string;
      }> =
        this.deps.dryRun || !moved
          ? {}
          : await new DeploymentService(client, secret.project_id)
              .extendPrimary(issuer, `Moved the dev port to ${devPort}`)
              .then(
                (extended) => {
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
                },
                (error: unknown) => {
                  if (isCancellation(error)) {
                    throw error;
                  }
                  return {
                    undeployed: `deploying to it failed: ${errorMessage(error)}`,
                  };
                },
              );
      for (const file of result.filesWritten) {
        moving.detail(
          `${this.deps.dryRun ? "Would update" : "Updated"} ${escapeControlCharacters(relativeDisplay(this.deps.cwd, file))}`,
        );
      }
      if (previousIssuer === issuer) {
        moving.done(`Already on ${issuer}`);
      } else {
        moving.done(
          `${this.deps.dryRun ? "Would move" : "Moved"} from ${escapeControlCharacters(previousIssuer)} to ${issuer}`,
        );
      }
      const replacing = !this.deps.dryRun && moved && portFromIssuer(previousIssuer) !== undefined;
      const consent = replacing
        ? await this.deps
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
      const staleOrigin = !replacing
        ? undefined
        : consent === undefined || consent === "refused"
          ? previousIssuer
          : await new OriginService(consent.unlock(client), secret.project_id)
              .remove(previousIssuer)
              .then(
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
        this.deps.recoverAt(source);
      }
      const cleanup =
        consent === "refused" && staleOrigin !== undefined
          ? this.deps.suggest({
              id: "origin:rm",
              args: { pattern: staleOrigin },
              flags: { force: true },
            })
          : undefined;
      const deploy =
        served.undeployed === undefined
          ? undefined
          : this.deps.suggest({
              id: "deploy",
              flags: { message: WHAT_CHANGED },
            });
      if (deploy !== undefined) {
        reportWarning(
          `${issuer} serves nothing until the next deploy: ${served.undeployed}. Run ${deploy}.`,
        );
      }
      if (staleOrigin !== undefined) {
        reportWarning(
          `${escapeControlCharacters(staleOrigin)} is still among the project's origins; it admits a port nothing serves any more.${cleanup === undefined ? "" : ` Remove it with ${cleanup}.`}`,
        );
      }
      for (const slug of ssoProviders) {
        reportWarning(
          `Social sign-in with ${slug} redirects to the old port: add ${callbackUriFor(issuer, slug)} as a redirect URI at the provider.`,
        );
      }
      const title = `${
        moved
          ? `${this.deps.dryRun ? "Would move" : "Moved"} the app to ${issuer}`
          : `The app is already on ${issuer}`
      }${this.deps.dryRun ? " (dry run)" : ""}`;
      return {
        status: "ok",
        data: {
          title,
          ...(this.deps.dryRun ? { dry_run: true } : {}),
          moved,
          previous_issuer: previousIssuer,
          issuer,
          dev_port: devPort,
          files_written: result.filesWritten.map((file) => {
            return relativeDisplay(this.deps.cwd, file);
          }),
          deployment_id: served.deploymentId ?? null,
        },
        summary: {
          title,
          sections: [],
          boxed: true,
        },
        next: {
          actions: this.deps.dryRun ? [] : [`Restart the dev server and open ${issuer}/login.`],
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
    } catch (error) {
      moving.fail();
      throw error;
    }
  }
}
