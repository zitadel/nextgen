import type { ListProjectPreviews200PreviewsItem } from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";

import { ApiService, type Page, type PageOptions } from "@/lib/backend/api-service";
import { pagedFunctions, type ZitadelClient } from "@/lib/backend/client";

/** A live preview, as the list of them returns it. */
export type LivePreview = ListProjectPreviews200PreviewsItem;

/** What pages a list of previews. */
export type PreviewPageQuery = Readonly<{
  limit?: number;
  page_token?: string;
}>;

/**
 * The live previews of one project: the pull-request deployments that expire on
 * their own.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 */
export class PreviewService extends ApiService {
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
   * List every live preview, across all pages.
   *
   * @returns The previews that are still being served.
   */
  async list(): Promise<readonly LivePreview[]> {
    return this.client.listProjectPreviews.all(this.projectId);
  }

  /**
   * List the live previews a page at a time.
   *
   * @param query - The page size and the cursor to continue from.
   * @param options - `all` to drain every page instead of reading one.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(query: PreviewPageQuery = {}, options: PageOptions = {}): Promise<Page<LivePreview>> {
    const paging = new Paging(pagedFunctions.listProjectPreviews);
    const pages = this.client.listProjectPreviews.pages(this.projectId, query);
    const collected = await paging.collect(pages, {
      all: options.all === true,
    });
    return {
      items: collected.items,
      next: collected.next,
    };
  }

  /**
   * Stop serving one preview origin.
   *
   * @param origin - The preview origin to stop serving.
   */
  async remove(origin: string): Promise<void> {
    await this.client.removeProjectPreview(this.projectId, {
      origin,
    });
  }
}
