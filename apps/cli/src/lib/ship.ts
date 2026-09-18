import { createZitadelClient, type ZitadelClient } from "@zitadel/api/client";
import type {
  CreateConfigurationRelease201,
  CreateDeployment201,
  CreateEnvironment201,
} from "@zitadel/api/generated/model";
import { consola } from "consola";

import { buildConfigurationBundle, recordBundleRevisions } from "./bundle";
import {
  originsForEntry,
  projectOriginsFromConfig,
  resolveEnvironmentTarget,
  type EnvironmentTarget,
} from "./environments";
import { readZitadelConfig, readZitadelSecret } from "./project";

/** The name of the environment every project serves by default. */
export const LIVE_ENVIRONMENT = "live";

/** Every preview environment lives under this prefix on the server. */
export const PREVIEW_PREFIX = "preview-";

export type ShipRelease = {
  id: string;
  /** One row per bundled resource: reused or newly allocated. */
  revisions: Array<{ kind: string; handle: string; revision_id: string; created: boolean }>;
  /** Local state files whose recorded revision id changed. */
  files_updated: string[];
};

/**
 * Builds a release from `.zitadel/` on the target project, or resolves the
 * one named by `releaseID` without touching the bundle.
 */
export async function buildRelease(opts: {
  cwd: string;
  client: ZitadelClient;
  target: EnvironmentTarget;
  message?: string;
  releaseID?: string;
}): Promise<ShipRelease> {
  if (opts.releaseID) {
    const release = await opts.client.getReleaseById(opts.releaseID, {
      project_id: opts.target.projectId,
    });
    return { id: release.id, revisions: [], files_updated: [] };
  }
  consola.start("Packaging .zitadel/ into a release");
  const bundle = await buildConfigurationBundle(opts.cwd);
  const body = opts.message ? { ...bundle.body, message: opts.message } : bundle.body;
  const result = (await opts.client.createConfigurationRelease(body, {
    project_id: opts.target.projectId,
  })) as CreateConfigurationRelease201;
  const filesUpdated = await recordBundleRevisions(
    opts.cwd,
    opts.target.projectId,
    bundle.resources,
    result.revisions,
  );
  const created = result.revisions.filter((r) => r.created).length;
  consola.success(
    `Release ${result.release.id} (${result.revisions.length} resource${result.revisions.length === 1 ? "" : "s"}, ${created} new revision${created === 1 ? "" : "s"})`,
  );
  return { id: result.release.id, revisions: result.revisions, files_updated: filesUpdated };
}

export type ShipDeployment = {
  id: string;
  environment: string;
  release_id: string;
  deployed_at: string;
};

/** Makes the release live on the named server environment. */
export async function deployRelease(opts: {
  client: ZitadelClient;
  target: EnvironmentTarget;
  environment: string;
  releaseID: string;
  message?: string;
}): Promise<ShipDeployment> {
  consola.start(`Deploying ${opts.releaseID} to ${opts.environment}`);
  const deployment = (await opts.client.createDeployment(
    {
      environment: opts.environment,
      release_id: opts.releaseID,
      reason: "deploy",
      ...(opts.message ? { message: opts.message } : {}),
    },
    { project_id: opts.target.projectId },
  )) as CreateDeployment201;
  consola.success(`${opts.environment} now runs ${deployment.release_id}`);
  return {
    id: deployment.id,
    environment: opts.environment,
    release_id: deployment.release_id,
    deployed_at: deployment.deployed_at,
  };
}

export type ShipPreview = {
  name: string;
  expires_at: string | null;
  origins: string[];
};

/** Creates or renews the preview environment on the target project. */
export async function ensurePreviewEnvironment(opts: {
  client: ZitadelClient;
  target: EnvironmentTarget;
  name: string;
  ttl?: string;
  origins: string[];
}): Promise<ShipPreview> {
  consola.start(`Preparing preview environment ${opts.name}`);
  const env = (await opts.client.createEnvironment(
    {
      name: opts.name,
      class: "preview",
      origins: opts.origins,
      ...(opts.ttl ? { ttl: opts.ttl } : {}),
    },
    { project_id: opts.target.projectId },
  )) as CreateEnvironment201;
  consola.success(
    `Preview ${env.name} ready${env.expires_at ? ` (expires ${env.expires_at})` : ""}`,
  );
  return { name: env.name, expires_at: env.expires_at ?? null, origins: env.origins ?? [] };
}

/**
 * Registers the fixed origins the target environment's frontend is served
 * from on the project's live environment, so production at
 * `https://app.vercel.app` is served by live even though the previews'
 * `https://*.vercel.app` covers it too. Wildcards are not live's business
 * and are skipped; no fixed origin means live is left as it is.
 */
export async function syncLiveOrigins(opts: {
  client: ZitadelClient;
  target: EnvironmentTarget;
}): Promise<string[]> {
  const origins = originsForEntry(opts.target.entry).filter((origin) => !origin.includes("*"));
  if (origins.length === 0) {
    return [];
  }
  await opts.client.createEnvironment(
    { name: LIVE_ENVIRONMENT, class: "live", origins },
    { project_id: opts.target.projectId },
  );
  consola.info(`Live origins     ${origins.join(", ")}`);
  return origins;
}

/** Resolves the target and builds an authenticated client for it. */
export async function connectEnvironment(opts: {
  cwd: string;
  name: string;
  env: NodeJS.ProcessEnv;
  serverFlag?: string;
}): Promise<{ target: EnvironmentTarget; client: ZitadelClient }> {
  const target = await resolveEnvironmentTarget(opts);
  consola.info(`Environment ${target.name}`);
  consola.info(`Server      ${target.server}`);
  consola.info(`Project     ${target.projectId}`);
  const client = createZitadelClient({ baseUrl: target.server, token: target.token });
  return { target, client };
}

/**
 * Makes the project's origin allowlist match `zitadel.json`: the union of
 * every environment entry's `issuer` and `issuer_pattern` that points at the
 * target project. The repository is the source of truth for which origins
 * may run the project's flows; a wildcard entry such as
 * `https://*.vercel.app` admits every preview deployment. No entry declares
 * an origin: the allowlist is left alone rather than cleared.
 */
export async function syncProjectOrigins(opts: {
  cwd: string;
  client: ZitadelClient;
  target: EnvironmentTarget;
}): Promise<{ origins: string[]; changed: boolean }> {
  const config = await readZitadelConfig(opts.cwd);
  // The project an entry without `project` belongs to: the top-level one,
  // else the one in .zitadel/secret (absent in CI, where the env secret
  // stands in and zitadel.json always names the project).
  let defaultProjectId = typeof config.project === "string" ? config.project : "";
  if (defaultProjectId === "") {
    defaultProjectId = (await readZitadelSecret(opts.cwd)).project_id;
  }
  const wanted = projectOriginsFromConfig(config, opts.target.projectId, defaultProjectId);
  if (wanted.length === 0) {
    return { origins: [], changed: false };
  }
  const current = (await opts.client.getProject(opts.target.projectId)).preview_origins ?? [];
  if (sameSet(current, wanted)) {
    return { origins: current, changed: false };
  }
  await opts.client.patchProject(opts.target.projectId, { preview_origins: wanted });
  consola.info(`Allowed origins  ${wanted.join(", ")}`);
  return { origins: wanted, changed: true };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...a].sort();
  return [...b].sort().every((value, i) => value === sorted[i]);
}

/** `preview-<slug>`: lowercased, non-alphanumerics collapsed to hyphens. */
export function previewEnvironmentName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = slug.startsWith(PREVIEW_PREFIX) ? slug : `${PREVIEW_PREFIX}${slug}`;
  return name.slice(0, 63).replace(/-+$/g, "");
}
