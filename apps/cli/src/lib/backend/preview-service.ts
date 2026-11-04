import type { ListPreviews200PreviewsItem } from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";
import { pagedFunctions, type ZitadelClient } from "./client";
import { ApiService, type Page } from "./api-service";

/** A live preview, as the list of them returns it. */
export type LivePreview = ListPreviews200PreviewsItem;

/** What pages a list of previews. `all` drains every page instead of reading one. */
export type PreviewPageQuery = Readonly<{
  limit?: number;
  page_token?: string;
  all?: boolean;
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
    return this.client.listPreviews.all(this.projectId);
  }

  /**
   * List the live previews a page at a time.
   *
   * @param query - The page size, the cursor to continue from, and `all` to drain every page.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(query: PreviewPageQuery = {}): Promise<Page<LivePreview>> {
    const { all, ...filter } = query;
    const paging = new Paging(pagedFunctions.listPreviews);
    const pages = this.client.listPreviews.pages(this.projectId, filter);
    const { items, next } = await paging.collect(pages, {
      all: all === true,
    });
    return Object.freeze({
      items,
      next,
    });
  }

  /**
   * Stop serving one preview origin.
   *
   * @param origin - The preview origin to stop serving.
   */
  async remove(origin: string): Promise<void> {
    await this.client.removePreview(this.projectId, {
      origin,
    });
  }
}
