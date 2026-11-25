import type {
  GetBranding200,
  ListBranding200,
  ListBrandingParams,
} from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";

import { ApiService, type Page, type PageOptions } from "@/lib/backend/api-service";
import { pagedFunctions, type ZitadelClient } from "@/lib/backend/client";

/** What pages a list of branding revisions. */
export type BrandingQuery = Readonly<Omit<ListBrandingParams, "project_id">>;

/** A branding revision, as a read returns it. */
export type BrandingRevision = GetBranding200;

/** A branding revision, as the list of them returns it. */
export type BrandingSummary = ListBranding200["branding"][number];

/** One page of branding revisions. */
export type BrandingPage = Page<BrandingSummary>;

/**
 * The branding revisions of one project: listing them and reading one.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
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
   * List the branding revisions, across all pages.
   *
   * @returns Every revision, newest first.
   */
  async list(): Promise<readonly BrandingSummary[]> {
    return this.client.listBranding.all({
      project_id: this.projectId,
    });
  }

  /**
   * List the branding revisions, a page at a time.
   *
   * @param query - The page size and the cursor to continue from.
   * @param options - `all` to drain every page instead of reading one.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(query: BrandingQuery = {}, options: PageOptions = {}): Promise<BrandingPage> {
    const paging = new Paging(pagedFunctions.listBranding);
    const pages = this.client.listBranding.pages({
      ...query,
      project_id: this.projectId,
    });
    const collected = await paging.collect(pages, {
      all: options.all === true,
    });
    return {
      items: collected.items,
      next: collected.next,
    };
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
