import type { CreateConfigurationRelease201 } from "@zitadel/api/generated/model";
import { consola } from "consola";

import type { ZitadelClient } from "./api-client";
import { buildConfigurationBundle } from "./bundle";

export type BuiltRelease = Readonly<{
  id: string;
  /** The SHA-256 over the pinned set, which a build pins with `sha256:<hash>`. */
  content_hash: string;
  /** False when the server already held a release of this content. */
  created: boolean;
  /** One entry per bundled resource: the revision pinned, and whether this call allocated it. */
  revisions: CreateConfigurationRelease201["revisions"];
  /** How many revisions this call allocated. */
  changed: number;
}>;

/**
 * Builds a release from `.zitadel/` on the target project: the files go up as
 * a bundle and the server reuses every revision whose content it already
 * holds, so identical content resolves to the release that already pins it.
 * No local state is read or written.
 */
export async function buildRelease(opts: {
  cwd: string;
  client: ZitadelClient;
  projectId: string;
  message?: string;
}): Promise<BuiltRelease> {
  const { body, resources } = await buildConfigurationBundle(opts.cwd);
  if (resources.length === 0) {
    throw new Error("nothing to release: .zitadel/ holds no schema, flow or branding");
  }
  const result = (await opts.client.createConfigurationRelease(
    { ...body, ...(opts.message ? { message: opts.message } : {}) },
    { project_id: opts.projectId },
  )) as CreateConfigurationRelease201;
  // The client cannot see the status code; a release the server already held
  // allocated no revision, which is the only thing a caller uses `created` for.
  const changed = result.revisions.filter((revision) => revision.created).length;
  const created = changed > 0;
  consola.success(`Release ${result.release.id}${created ? "" : " (exists, reusing)"}`);
  return {
    id: result.release.id,
    content_hash: result.release.content_hash,
    created,
    revisions: result.revisions,
    changed,
  };
}
