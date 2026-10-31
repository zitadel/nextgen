import type { ZitadelClient } from "@zitadel/api/client";
import type {
  BuildRelease200,
  BuildRelease201,
  BuildReleaseBody,
} from "@zitadel/api/generated/model";

import type { ConfigurationBundle } from "./bundle";

/**
 * A release, as build returns it: 200 when the bundle matched a release that
 * already carries it, 201 when it built a new one. The two shapes match.
 */
export type Release = BuildRelease200 | BuildRelease201;

/** Metadata recorded alongside a release, mirroring the source commit. */
export type ReleaseSource = {
  message?: string;
  gitSha: string | null;
  gitDirty: boolean;
};

/**
 * Build a release from the `.zitadel/` bundle (`POST /releases/build`). The
 * server reuses the revisions that already match and allocates the rest, and
 * dedupes on content: re-posting the same bundle returns the release that
 * already carries it. (`POST /releases` pins pre-existing revision ids and is
 * not a CLI flow.)
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
  } as unknown as BuildReleaseBody;
  return client.buildRelease(body, { project_id: projectId });
}

/** Revoke a release so its content is never served again. Idempotent. */
export async function revokeRelease(
  client: ZitadelClient,
  projectId: string,
  releaseId: string,
): Promise<Release> {
  return client.revokeRelease(releaseId, { project_id: projectId });
}
