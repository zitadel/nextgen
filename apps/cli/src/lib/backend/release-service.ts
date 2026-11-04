import { BuildReleaseBody as BuildReleaseBodySchema } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import type {
  BuildRelease200,
  BuildRelease201,
  BuildReleaseBody,
  GetReleaseById200,
} from "@zitadel/api/generated/model";

import type { ZitadelClient } from "../api-client";
import type { Consent } from "../consent";
import { ZitadelError } from "../errors";

/**
 * The resources of `.zitadel/` as `POST /releases/build` takes them, as read
 * from disk. Deliberately looser than the API's own `BuildReleaseBody["bundle"]`:
 * the files are loose JSON until the checks have run, and {@link ReleaseService.create}
 * narrows the body to the API's type before sending it.
 */
export type ConfigurationBundle = Readonly<{
  schemas: readonly Record<string, unknown>[];
  flow_definitions: readonly Record<string, unknown>[];
  idps: readonly Record<string, unknown>[];
  policies?: readonly Record<string, unknown>[];
  branding?: Readonly<Record<string, unknown>>;
}>;

/** Metadata recorded alongside a release, mirroring the source commit. */
export type ReleaseSource = Readonly<{
  message?: string;
  gitSha: string | null;
  gitDirty: boolean;
}>;

/**
 * A release, as build returns it: 200 when the bundle matched a release that
 * already carries it, 201 when it built a new one. The two shapes match.
 */
export type Release = BuildRelease200 | BuildRelease201;

/**
 * The releases of one project: reading one, building one from a configuration
 * bundle, and revoking it.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 */
export class ReleaseService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * Read one release.
   *
   * @param releaseId - The release to read.
   * @returns The release, with the revisions it points at.
   */
  async get(releaseId: string): Promise<GetReleaseById200> {
    return this.client.getReleaseById(releaseId, {
      project_id: this.projectId,
    });
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
   * @throws ZitadelError `E_CONFLICT` when the content matches a release that was revoked. The server
   * dedupes on content, so the same tree always builds back to that release, and a revoked release
   * can never be served.
   */
  async create(bundle: ConfigurationBundle, source: ReleaseSource): Promise<Release> {
    const body = {
      bundle,
      ...(source.message === undefined
        ? {}
        : {
            message: source.message,
          }),
      ...(source.gitSha === null
        ? {}
        : {
            git_sha: source.gitSha,
          }),
      git_dirty: source.gitDirty,
    };
    ReleaseService.assertBuildBody(body);
    const release = await this.client.buildRelease(body, {
      project_id: this.projectId,
    });
    if (release.revoked_at) {
      throw new ZitadelError(
        "E_CONFLICT",
        `This content was already released as ${release.id}, which is revoked`,
        {
          hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
          details: {
            release_id: release.id,
            content_hash: release.content_hash,
          },
        },
      );
    }
    return release;
  }

  /**
   * Revoke a release so its content is never served again. Idempotent.
   *
   * @param consent - The proof the caller was allowed to do something irreversible.
   * @param releaseId - The release to revoke.
   * @returns The release, now revoked.
   */
  async revoke(consent: Consent, releaseId: string): Promise<Release> {
    return consent.unlock(this.client).revokeRelease(releaseId, {
      project_id: this.projectId,
    });
  }

  /**
   * Narrow a body to the API's type before it is sent. The bundle is read from
   * disk as loose JSON and `validate` has already held each file to the API's
   * rules, naming it; this sends the body as read and fills in no defaults.
   *
   * @throws ZitadelError `E_VALIDATION` naming each field the API does not take.
   */
  private static assertBuildBody(body: unknown): asserts body is BuildReleaseBody {
    const checked = BuildReleaseBodySchema.safeParse(body);
    if (checked.success) {
      return;
    }
    const issues = checked.error.issues;
    const noun = issues.length === 1 ? "issue" : "issues";
    throw new ZitadelError(
      "E_VALIDATION",
      `The release body does not match what the API takes, so nothing was sent (${issues.length} ${noun}):\n` +
        issues
          .map((issue) => {
            return `  - ${issue.path.join(".") || "(root)"} ${issue.message}`;
          })
          .join("\n"),
      {
        details: {
          issues,
        },
      },
    );
  }
}
