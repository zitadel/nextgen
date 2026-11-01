import type { ZitadelClient } from "@zitadel/api/client";
import { BuildReleaseBody as BuildReleaseBodySchema } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import type {
  BuildRelease200,
  BuildRelease201,
  BuildReleaseBody,
} from "@zitadel/api/generated/model";

import { ZitadelError } from "../errors";
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
  const body = {
    bundle,
    ...(source.message === undefined ? {} : { message: source.message }),
    ...(source.gitSha === null ? {} : { git_sha: source.gitSha }),
    git_dirty: source.gitDirty,
  };
  // The bundle is read from disk as loose JSON. `validate` has already held
  // each file to the API's rules, naming it; this narrows the body to the
  // API's type before it is sent, and sends it as read: the check fills in no
  // defaults.
  assertBuildReleaseBody(body);
  return client.buildRelease(body, { project_id: projectId });
}

/** Refuses a body `POST /releases/build` does not take, naming each field it refuses. */
function assertBuildReleaseBody(body: unknown): asserts body is BuildReleaseBody {
  const checked = BuildReleaseBodySchema.safeParse(body);
  if (!checked.success) {
    const issues = checked.error.issues;
    const noun = issues.length === 1 ? "issue" : "issues";
    throw new ZitadelError(
      "E_VALIDATION",
      `The release body does not match what the API takes, so nothing was sent (${issues.length} ${noun}):\n` +
        issues
          .map((issue) => `  - ${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("\n"),
      { details: { issues } },
    );
  }
}

/** Revoke a release so its content is never served again. Idempotent. */
export async function revokeRelease(
  client: ZitadelClient,
  projectId: string,
  releaseId: string,
): Promise<Release> {
  return client.revokeRelease(releaseId, { project_id: projectId });
}
