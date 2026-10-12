import type { ZitadelClient } from "@zitadel/api/client";
import type {
  CreateRelease201,
  CreateReleaseBody,
  GetReleaseById200,
  ListReleases200ReleasesItem,
} from "@zitadel/api/generated/model";

import type { ConfigurationBundle } from "./bundle";

/**
 * A release, as every create/get returns it. `CreateRelease200` (the dedupe
 * answer) and `CreateRelease201` share this shape, so one alias covers both.
 */
export type Release = CreateRelease201;

/** Metadata recorded alongside a release, mirroring the source commit. */
export type ReleaseSource = {
  message?: string;
  gitSha: string | null;
  gitDirty: boolean;
};

/**
 * Post a release built from the `.zitadel/` bundle. The server reuses the
 * revisions that already match and allocates the rest, and dedupes on content:
 * re-posting the same bundle returns the release that already carries it.
 */
export async function createReleaseFromBundle(
  client: ZitadelClient,
  projectId: string,
  bundle: ConfigurationBundle,
  source: ReleaseSource,
): Promise<Release> {
  // The bundle is read from disk as loose JSON; the generated body types each
  // resource strictly. The server re-validates every one, so cast at the edge.
  const body = {
    bundle,
    ...(source.message === undefined ? {} : { message: source.message }),
    ...(source.gitSha === null ? {} : { git_sha: source.gitSha }),
    git_dirty: source.gitDirty,
  } as unknown as CreateReleaseBody;
  const result = await client.createRelease(body, { project_id: projectId });
  return result as Release;
}

/** Revoke a release so its content is never served again. Idempotent. */
export async function revokeRelease(
  client: ZitadelClient,
  projectId: string,
  releaseId: string,
): Promise<Release> {
  return client.revokeRelease(releaseId, { project_id: projectId });
}

/** The release a digest names, or undefined when the project carries none. */
export async function findReleaseByContentHash(
  client: ZitadelClient,
  projectId: string,
  contentHash: string,
): Promise<ListReleases200ReleasesItem | undefined> {
  const { releases } = await client.listReleases({
    project_id: projectId,
    content_hash: contentHash,
  });
  return releases[0];
}

/** Read one release by its `rel_` id. */
export async function getRelease(
  client: ZitadelClient,
  projectId: string,
  releaseId: string,
): Promise<GetReleaseById200> {
  return client.getReleaseById(releaseId, { project_id: projectId });
}
