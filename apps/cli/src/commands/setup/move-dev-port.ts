import { basename } from "node:path";

import {
  DeploymentService,
  OriginService,
  createZitadelClient,
  type ZitadelClient,
} from "@/lib/backend";

import { type Consent, type Gate, isRefusal } from "@/lib/consent";
import { errorMessage, isCancellation, toZitadelError, ZitadelError } from "@/lib/errors";
import { DiskStore, ZitadelConfig } from "@/lib/zitadel";
import { issuerFromPort, type Orca } from "@/lib/orca";
import { portFromIssuer } from "@/lib/orca/detectors/port";
import { replaceOrigin } from "@/lib/orca/patchers/rule/dev-port-move";
import type { PatchResult } from "@/lib/orca/patchers/types";
import { readZitadelSecret, writeZitadelSecret } from "@/lib/project";
import { readScaffoldManifest } from "@/lib/scaffold-manifest";
import { updateScaffold } from "@/lib/sync/state";
import { loadPatchContext } from "@/commands/doctor/patch-context";
import { userAgent } from "@/lib/user-agent";

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
}): Promise<DevPortMove> {
  const { cwd, devPort, source, orca, cliVersion, dryRun, signal } = opts;
  const context = await loadPatchContext(cwd, orca, cliVersion);
  const previousIssuer = context.issuer;
  const issuer = issuerFromPort(devPort);
  const secret = await readZitadelSecret(cwd);
  const moving = previousIssuer !== issuer;
  // Read before anything changes, so a configuration that cannot be read
  // stops the move rather than leaving it half made.
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
    framework: { ...context.framework, devPort, url: issuer },
  };
  const patcher = orca.patcherFor(ctx.framework.id);
  const result = await patcher.moveDevPort(ctx, previousIssuer, { cwd, dryRun, force: false });

  if (!dryRun) {
    // The app's own origin is primary, so the move rewrites that list. An
    // older secret that still carries the issuer as a preview pattern is
    // rewritten too, so the stale URL is not left behind either way.
    const rewrite = (patterns: string[]): string[] =>
      replaceOrigin(patterns, previousIssuer, issuer).filter(
        (pattern) => typeof pattern === "string",
      );
    await writeZitadelSecret(cwd, {
      ...secret,
      primary_origins: rewrite(secret.primary_origins),
      preview_origins: rewrite(secret.preview_origins),
    });
    const manifest = await readScaffoldManifest(cwd);
    if (manifest !== undefined) {
      await updateScaffold(cwd, { ...manifest, dev_port: devPort });
    }
  }
  const served =
    dryRun || !moving ? {} : await serveNewOrigin(client, secret.project_id, issuer, devPort);
  const replacing = !dryRun && moving && portFromIssuer(previousIssuer) !== undefined;
  // A refusal for want of --force leaves the origin behind and says so;
  // anything else the request for consent throws (Ctrl-C, a bug) stops
  // the run.
  const consent = replacing
    ? await opts
        .consent({
          verb: "replace",
          name: `remove ${previousIssuer} from the project's origins`,
          message: `Remove ${previousIssuer}, the app's previous origin, from the project? ${issuer} replaces it.`,
        })
        .catch((error: unknown) => {
          if (isRefusal(error)) {
            return "refused" as const;
          }
          throw error;
        })
    : undefined;
  const refused = consent === "refused" ? true : undefined;
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
          () => {
            return previousIssuer;
          },
        );

  return {
    previousIssuer,
    issuer,
    result,
    ssoProviders,
    ...(staleOrigin === undefined ? {} : { staleOrigin }),
    ...(refused === undefined ? {} : { refused }),
    ...served,
  };
}

/**
 * Deploys the project's newest primary release again so `issuer`, a primary
 * origin added since, serves it too: the deployment it made, or why the new
 * origin serves nothing yet. Only a cancellation is thrown.
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
      case "deployed":
        return { deploymentId: extended.deployment.id };
      case "unchanged":
        return {};
      case "none":
        return { undeployed: "nothing is deployed to the project yet" };
      case "raced":
        return { undeployed: "another deploy landed while the app moved" };
      case "revoked":
        return { undeployed: "the release the previous port ran is revoked" };
    }
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return { undeployed: `deploying to it failed: ${errorMessage(error)}` };
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
  const named = [
    ...config.connections.all.map((connection) => {
      return { path: connection.path, name: connection.slug };
    }),
    ...config.broken
      .filter((file) => {
        return file.kind === "connection";
      })
      .map((file) => {
        return { path: file.path, name: basename(file.path, ".json") };
      }),
  ];
  return named
    .sort((left, right) => {
      return left.path.localeCompare(right.path);
    })
    .map((connection) => {
      return connection.name;
    });
}
