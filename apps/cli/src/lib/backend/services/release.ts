import type {
  BuildRelease200,
  BuildRelease201,
  BuildReleaseBody,
  GetReleaseById200,
  GetReleaseById200PointersItem,
  GetReleaseById200PointersItemKind,
} from "@zitadel/api/generated/model";
import { z } from "zod";

import type { ZitadelClient } from "@/lib/backend/client";
import { ApiService } from "@/lib/backend/api-service";
import { ConflictError } from "@/lib/backend/errors";

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
 * The origins a `rel.in_use` refusal names, each with the deployment that pins
 * the release there. An empty list is rejected: a refusal naming no origin has
 * nothing to show, so it stays the plain conflict.
 */
const IN_USE_ORIGINS = z
  .array(
    z.object({
      origin: z.string(),
      deployment_id: z.string(),
    }),
  )
  .min(1);

/**
 * The body of a `rel.in_use` refusal, parsed rather than trusted: one that does
 * not hold the origins the contract promises is rethrown as the conflict it is.
 * The origins are read at both depths, as the error mapper reads them: the
 * typed answer carries them in `details`, the generic one a level down.
 */
const RELEASE_IN_USE_BODY = z.object({
  details: z.union([
    z.object({ origins: IN_USE_ORIGINS }),
    z.object({ details: z.object({ origins: IN_USE_ORIGINS }) }),
  ]),
});

/**
 * What revoking a release came to: revoked, or refused because origins still
 * serve it, each one named with the deployment that pins the release there.
 */
export type RevokeOutcome =
  | Readonly<{ outcome: "revoked"; release: Release }>
  | Readonly<{ outcome: "in-use"; origins: readonly z.infer<typeof IN_USE_ORIGINS>[number][] }>;

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
export class ReleaseService extends ApiService {
  private readonly projectId: string;

  /**
   * Bind the service to a client and the project every call concerns.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project every call concerns.
   */
  constructor(client: ZitadelClient, projectId: string) {
    super(client);
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
   * @throws ConflictError when the content matches a release that was
   * revoked. The server dedupes on content, so the same tree always builds back
   * to that release, and a revoked release can never be served.
   */
  async create(input: ReleaseInput): Promise<Release> {
    const release = await this.client.buildRelease(input, {
      project_id: this.projectId,
    });
    if (release.revoked_at) {
      throw new ConflictError(
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
   * @param releaseId - The release to revoke.
   * @returns `revoked` with the release, or `in-use` with each origin that still
   * serves it and the deployment that pins it there.
   * @throws ConflictError for any other conflict, and any other failure as the
   * client raised it, including a `rel.in_use` refusal that names no origin.
   */
  async revoke(releaseId: string): Promise<RevokeOutcome> {
    try {
      const release = await this.client.revokeRelease(releaseId, {
        project_id: this.projectId,
      });
      return { outcome: "revoked", release };
    } catch (error) {
      if (error instanceof ConflictError && error.serverCode === "rel.in_use") {
        const refusal = RELEASE_IN_USE_BODY.safeParse(error.body);
        if (refusal.success) {
          const { details } = refusal.data;
          return {
            outcome: "in-use",
            origins: "origins" in details ? details.origins : details.details.origins,
          };
        }
      }
      throw error;
    }
  }
}
