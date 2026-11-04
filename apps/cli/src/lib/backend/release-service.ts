import type {
  BuildRelease200,
  BuildRelease201,
  BuildReleaseBody,
  GetReleaseById200,
  GetReleaseById200PointersItem,
  GetReleaseById200PointersItemKind,
} from "@zitadel/api/generated/model";
import type { ZitadelClient } from "../gateway/client";
import type { Consent } from "../gateway/consent";
import { ZitadelError } from "../errors";

/** What building a release takes: the bundle, a message and the commit it was built from. */
export type ReleaseInput = Readonly<BuildReleaseBody>;

/**
 * A release, as build returns it: 200 when the bundle matched a release that
 * already carries it, 201 when it built a new one. The two shapes match.
 */
export type Release = BuildRelease200 | BuildRelease201;

/** A release with the revisions it points at, as a read returns it. */
export type ReleaseRecord = GetReleaseById200;

/** One revision a release pins. */
export type ReleasePointer = GetReleaseById200PointersItem;

/** The kind of resource a release pins a revision of. */
export type ReleasePointerKind = GetReleaseById200PointersItemKind;

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
  async get(releaseId: string): Promise<ReleaseRecord> {
    return this.client.getReleaseById(releaseId, {
      project_id: this.projectId,
    });
  }

  /**
   * Build a release from a bundle (`POST /releases/build`). The server reuses
   * the revisions that already match and allocates the rest, and dedupes on
   * content: building the same bundle again returns the release that already
   * carries it.
   *
   * @param input - The bundle, a message and the commit it was built from.
   * @returns The release, new or the one that already carried the bundle.
   * @throws ZitadelError `E_CONFLICT` when the content matches a release that was
   * revoked. The server dedupes on content, so the same tree always builds back
   * to that release, and a revoked release can never be served.
   */
  async create(input: ReleaseInput): Promise<Release> {
    const release = await this.client.buildRelease(input, {
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
    const unlocked = consent.unlock(this.client);
    return unlocked.revokeRelease(releaseId, {
      project_id: this.projectId,
    });
  }
}
