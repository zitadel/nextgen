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

/** An origin that still serves a release, with the deployment that pins the release there. */
export type ServedOrigin = Readonly<{
  origin: string;
  deploymentId: string;
}>;

/**
 * What revoking a release came to: revoked, or refused because origins still
 * serve it, each one named with the deployment that pins the release there.
 */
export type RevokeOutcome =
  | Readonly<{ outcome: "revoked"; release: Release }>
  | Readonly<{ outcome: "in-use"; origins: readonly ServedOrigin[] }>;

/** The origins a `rel.in_use` refusal carries, each with the deployment that pins the release there. */
const ServedOriginsDetails = z.object({
  origins: z.array(
    z.object({
      origin: z.string(),
      deployment_id: z.string(),
    }),
  ),
});

/**
 * The body of a `rel.in_use` refusal. The server nests the details it writes
 * one level deeper than the payload itself, so the payload is accepted at either
 * depth: the serialiser's wrapper is not part of the contract, and a reader that
 * insisted on it would go silent the day it goes away.
 */
const ServedOriginsBody = z.object({
  details: z.union([ServedOriginsDetails, z.object({ details: ServedOriginsDetails })]),
});

/**
 * The origins a `rel.in_use` refusal names. The body is parsed rather than
 * trusted: a body that does not hold the expected shape names none.
 *
 * @param body - The parsed error body the server answered with.
 * @returns The origins it names, empty when it names none.
 */
function servedOriginsOf(body: unknown): ServedOrigin[] {
  const parsed = ServedOriginsBody.safeParse(body);
  if (!parsed.success) {
    return [];
  }
  const { details } = parsed.data;
  const payload = "origins" in details ? details : details.details;
  return payload.origins.map(({ origin, deployment_id }) => ({
    origin,
    deploymentId: deployment_id,
  }));
}

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
   * serves it and the deployment that pins it there. Any other failure is thrown.
   */
  async revoke(releaseId: string): Promise<RevokeOutcome> {
    try {
      const release = await this.client.revokeRelease(releaseId, {
        project_id: this.projectId,
      });
      return { outcome: "revoked", release };
    } catch (error) {
      if (error instanceof ConflictError && error.serverCode === "rel.in_use") {
        const origins = servedOriginsOf(error.body);
        if (origins.length > 0) {
          return { outcome: "in-use", origins };
        }
      }
      throw error;
    }
  }
}
