import type {
  BuildRelease200,
  BuildRelease201,
  BuildReleaseBody,
  GetReleaseById200,
  GetReleaseById200PointersItem,
  GetReleaseById200PointersItemKind,
  RevokeRelease409DetailsOriginsItem,
} from "@zitadel/api/generated/model";
import { isCancelled, type ZitadelClient } from "@/lib/backend/client";
import { ApiService } from "@/lib/backend/api-service";
import { ConflictError } from "@/lib/backend/errors";
import { type Origins, OriginService } from "./origin";

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

/** An origin that still serves a release, and the deployment that pins it there. */
export type ServingOrigin = Readonly<
  RevokeRelease409DetailsOriginsItem & {
    /** What the origin is to the project; `unknown` when its origins could not be read. */
    kind: ReturnType<Origins["kindOf"]>;
  }
>;

/**
 * What revoking a release came to: `revoked`, or `in-use` when origins still
 * serve it; `origins` names each one and the deployment that pins it.
 */
export type RevokeResult = Readonly<
  | {
      outcome: "revoked";
      release: Release;
    }
  | {
      outcome: "in-use";
      origins: readonly ServingOrigin[];
    }
>;

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
   * @returns The release, now revoked, or the origins that still serve it.
   * @throws BackendError for any failure other than an origin serving it.
   */
  async revoke(releaseId: string): Promise<RevokeResult> {
    try {
      const release = await this.client.revokeRelease(releaseId, {
        project_id: this.projectId,
      });
      return {
        outcome: "revoked",
        release,
      };
    } catch (error) {
      if (!(error instanceof ConflictError) || error.serverCode !== "rel.in_use") {
        throw error;
      }
      const served = servingOrigins(error.body);
      // The kinds only shape what to do next; a read that fails here leaves
      // them unknown rather than replacing the refusal with its own error.
      const origins = await new OriginService(this.client, this.projectId)
        .list()
        .catch((cause: unknown): undefined => {
          if (isCancelled(this.client)) {
            throw cause;
          }
          return undefined;
        });
      return {
        outcome: "in-use",
        origins: served.map((one) => {
          return { ...one, kind: origins?.kindOf(one.origin) ?? "unknown" };
        }),
      };
    }
  }
}

/**
 * The origins a `rel.in_use` refusal names. The server nests them in the
 * envelope's `details.details`, the contract in `details`, so both are read.
 */
function servingOrigins(body: unknown): RevokeRelease409DetailsOriginsItem[] {
  let node: unknown = body;
  for (let depth = 0; depth < 3 && isObject(node); depth += 1) {
    const { origins } = node;
    if (Array.isArray(origins)) {
      return origins.filter((item): item is RevokeRelease409DetailsOriginsItem => {
        return (
          isObject(item) &&
          typeof item.origin === "string" &&
          typeof item.deployment_id === "string"
        );
      });
    }
    node = node.details;
  }
  return [];
}

/** Whether a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
