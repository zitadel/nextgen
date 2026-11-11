import type { GetBranding200, ListBranding200Item } from "@zitadel/api/generated/model";
import type { ZitadelClient } from "@/lib/backend/client";
import { ApiService } from "@/lib/backend/api-service";

/** A branding revision, as a read returns it. */
export type BrandingRevision = GetBranding200;

/** A branding revision, as the list of them returns it. */
export type BrandingSummary = ListBranding200Item;

/**
 * The branding revisions of one project: listing them and reading one.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 *
 * Its endpoint does not page, so it answers `list` alone: there is no cursor
 * for a `page` to carry.
 */
export class BrandingService extends ApiService {
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
   * List the branding revisions.
   *
   * @returns Every revision, in the order the server answers them.
   */
  async list(): Promise<readonly BrandingSummary[]> {
    return this.client.listBranding({
      project_id: this.projectId,
    });
  }

  /**
   * Read one branding revision.
   *
   * @param revisionId - The revision to read.
   * @returns The revision.
   */
  async get(revisionId: string): Promise<BrandingRevision> {
    return this.client.getBranding(revisionId);
  }
}
