import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { createZitadelClient } from "../../lib/api-client";
import { toZitadelError, ZitadelError } from "../../lib/errors";
import { IDPS_DIR } from "../../lib/idp/connections";
import { issuerFromPort, type Orca } from "../../lib/orca";
import { portFromIssuer } from "../../lib/orca/detectors/port";
import { replaceOrigin } from "../../lib/orca/patchers/rule/dev-port-move";
import type { PatchResult } from "../../lib/orca/patchers/types";
import { readZitadelSecret, writeZitadelSecret } from "../../lib/project";
import { readScaffoldManifest } from "../../lib/scaffold-manifest";
import { updateScaffold } from "../../lib/sync/state";
import { loadPatchContext } from "../doctor/patch-context";

/** What {@link moveDevPort} changed. */
export type DevPortMove = Readonly<{
  previousIssuer: string;
  issuer: string;
  result: PatchResult;
  /** The provider slugs whose redirect URI still names the previous port. */
  ssoProviders: ReadonlyArray<string>;
  /** Set when the previous origin could not be removed from the project. */
  staleOrigin?: string;
}>;

/**
 * Moves an app setup already patched to another dev port, in one step: the
 * project's origin on the server, then the dev script or dev-server config,
 * `ZITADEL_ISSUER` in `.env.local`, `zitadel.json`, `.zitadel/secret` and the
 * README/AGENTS.md guidance. Backs `setup --dev-port` on an app that already
 * has a `zitadel.json`, which otherwise has nothing left to set up.
 *
 * The new origin is added before any file changes, so a server that refuses
 * leaves the app as it was. The previous origin is removed last; a failure
 * there is reported, not thrown, because the app already works on the new
 * port and the old pattern only admits a port nothing serves any more.
 */
export async function moveDevPort(opts: {
  cwd: string;
  devPort: number;
  source: string;
  orca: Orca;
  cliVersion: string;
  dryRun: boolean;
}): Promise<DevPortMove> {
  const { cwd, devPort, source, orca, cliVersion, dryRun } = opts;
  const context = await loadPatchContext(cwd, orca, cliVersion);
  const previousIssuer = context.issuer;
  const issuer = issuerFromPort(devPort);
  const secret = await readZitadelSecret(cwd);
  const moving = previousIssuer !== issuer;

  const client = createZitadelClient({ baseUrl: source, token: secret.project_secret });
  if (!dryRun) {
    try {
      await client.addOrigin(secret.project_id, { pattern: issuer, kind: "primary" });
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

  let staleOrigin: string | undefined;
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
    if (moving && portFromIssuer(previousIssuer) !== undefined) {
      try {
        await client.removeOrigin(secret.project_id, { pattern: previousIssuer });
      } catch {
        staleOrigin = previousIssuer;
      }
    }
  }

  return {
    previousIssuer,
    issuer,
    result,
    ssoProviders: moving ? await connectionSlugs(cwd) : [],
    ...(staleOrigin === undefined ? {} : { staleOrigin }),
  };
}

/** The slugs of the connection files under `.zitadel/idps/`. */
async function connectionSlugs(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, IDPS_DIR));
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort();
  } catch {
    return [];
  }
}
