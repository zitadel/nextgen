import { BuildReleaseBody as BuildReleaseBodySchema } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import type {
  BuildRelease200,
  BuildRelease201,
  BuildReleaseBody,
} from "@zitadel/api/generated/model";

import type { ZitadelClient } from "../api-client";
import type { Consent } from "../consent";
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
 * The releases of one project: building one from a configuration bundle, reading
 * it back, and revoking it.
 *
 * @remarks
 * A Service Layer (Fowler, Patterns of Enterprise Application Architecture) over the generated API client, which plays the Gateway: a command says what should happen and never which endpoint serves it. Bound to one project at construction, so a call carries only what is specific to it.
 */
export class ReleaseService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * Build a release from the `.zitadel/` bundle (`POST /releases/build`). The
   * server reuses the revisions that already match and allocates the rest, and
   * dedupes on content: re-posting the same bundle returns the release that
   * already carries it. (`POST /releases` pins pre-existing revision ids and is
   * not a CLI flow.)
   *
   * @param bundle - What `.zitadel/` holds, as read from disk.
   * @param source - The commit the bundle was built from.
   * @returns The release, new or the one that already carried the bundle.
   * @throws ZitadelError `E_VALIDATION` naming each field the API does not take, before anything is sent.
   */
  async create(bundle: ConfigurationBundle, source: ReleaseSource): Promise<Release> {
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
    return this.client.buildRelease(body, { project_id: this.projectId });
  }

  /** Read one release, with the revisions it points at. */
  async get(releaseId: string) {
    return this.client.getReleaseById(releaseId, { project_id: this.projectId });
  }

  /**
   * Revoke a release so its content is never served again. Idempotent.
   *
   * @param consent - The proof the caller was allowed to do something irreversible.
   * @param releaseId - The release to revoke.
   */
  async revoke(consent: Consent, releaseId: string): Promise<Release> {
    return consent.unlock(this.client).revokeRelease(releaseId, { project_id: this.projectId });
  }
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
