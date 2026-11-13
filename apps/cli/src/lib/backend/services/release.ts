import {
  type BuildRelease200,
  type BuildRelease201,
  type BuildReleaseBody,
  type GetReleaseById200,
  type GetReleaseById200PointersItem,
  type GetReleaseById200PointersItemKind,
  type RevokeRelease409,
  type RevokeRelease409DetailsOriginsItem,
  RevokeRelease409DetailsOriginsItemKind,
} from "@zitadel/api/generated/model";
import { z } from "zod";

import { ApiService } from "@/lib/backend/api-service";
import type { ZitadelClient } from "@/lib/backend/client";
import { ConflictError } from "@/lib/backend/errors";

/**
 * One origin that serves a release.
 *
 * @remarks
 * Names the deployment that pins the release there, and whether the origin is
 * a primary origin or a preview, which is freed differently: a primary origin
 * by putting another release live on it, a preview by removing it.
 */
export type ServingOrigin = Readonly<RevokeRelease409DetailsOriginsItem>;

/**
 * The refusal to revoke a release an origin still serves.
 *
 * @remarks
 * Raised only when the server's answer names the origins, so a caller that
 * catches it always has at least one. It is a {@link ConflictError} that
 * carries the server's answer as it came, so a caller that does not know it
 * handles it as the plain conflict it also is.
 */
export class ReleaseInUseError extends ConflictError {
  /** The error's name, which a caller that cannot import the class matches on. */
  override readonly name: string = "ReleaseInUseError";

  /** Every origin that serves the release, in the order the server named them. */
  readonly origins: readonly ServingOrigin[];

  /**
   * @param message - The server's message.
   * @param origins - Every origin that serves the release.
   * @param options - What the server's answer carried: status, URL, body and request id.
   */
  constructor(
    message: string,
    origins: readonly ServingOrigin[],
    options: ConstructorParameters<typeof ConflictError>[1] = {},
  ) {
    super(message, options);
    this.origins = origins;
  }

  /**
   * The origins that serve the release as primary origins, which a different
   * release put live on them frees.
   *
   * @returns Those of {@link ReleaseInUseError.origins} that are primary origins.
   */
  get primaries(): readonly ServingOrigin[] {
    return this.origins.filter((origin) => {
      return origin.kind === RevokeRelease409DetailsOriginsItemKind.primary;
    });
  }

  /**
   * The origins that serve the release as previews, which removing the preview
   * frees.
   *
   * @returns Those of {@link ReleaseInUseError.origins} that are previews.
   */
  get previews(): readonly ServingOrigin[] {
    return this.origins.filter((origin) => {
      return origin.kind === RevokeRelease409DetailsOriginsItemKind.preview;
    });
  }
}

/**
 * The origins a `rel.in_use` answer names, as the API documents them.
 *
 * @remarks
 * The generated client types the 409 body but, as every error body, does not
 * validate it, so the answer is checked here before it is trusted. The kinds
 * are the generated ones, so a kind the API adds is not left out by this schema
 * alone.
 */
const InUseBody = z.object({
  details: z.object({
    origins: z
      .array(
        z.object({
          origin: z.string().min(1),
          deployment_id: z.string().min(1),
          kind: z.enum(RevokeRelease409DetailsOriginsItemKind),
        }),
      )
      .min(1),
  }),
}) satisfies z.ZodType<Pick<RevokeRelease409, "details">>;

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
   * @returns The release, now revoked.
   * @throws ReleaseInUseError when an origin still serves the release, naming
   * each such origin.
   */
  async revoke(releaseId: string): Promise<Release> {
    try {
      return await this.client.revokeRelease(releaseId, {
        project_id: this.projectId,
      });
    } catch (error) {
      if (!(error instanceof ConflictError) || error.serverCode !== "rel.in_use") {
        throw error;
      }
      const served = InUseBody.safeParse(error.body);
      if (!served.success) {
        throw error;
      }
      throw new ReleaseInUseError(error.message, served.data.details.origins, {
        status: error.status,
        url: error.url,
        body: error.body,
        requestId: error.requestId,
        cause: error,
      });
    }
  }
}
