import type { ZitadelClient } from "@zitadel/api/client";
import type { BuildRelease201, BuildReleaseBody } from "@zitadel/api/generated/model";

import type { ConfigurationBundle } from "./bundle";

/**
 * A release, as every build/get returns it. `BuildRelease200` (the dedupe
 * answer) and `BuildRelease201` share this shape, so one alias covers both.
 */
export type Release = BuildRelease201;

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
  const result = await client.buildRelease(body, { project_id: projectId });
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

/**
 * A content hash short enough for a line of the chain — a step of it, or the
 * line it closes on. `sha256:` and 64 hex digits is wider than one line, so
 * the digest is cut to the 12 characters that identify it in practice; the
 * full hash stays in the envelope, where something might match on it.
 */
export function abbreviate(hash: string): string {
  const separator = hash.indexOf(":");
  const algorithm = separator < 0 ? "" : hash.slice(0, separator + 1);
  return `${algorithm}${hash.slice(separator + 1, separator + 13)}`;
}
