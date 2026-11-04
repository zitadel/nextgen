import type { ListPreviews200PreviewsItem } from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";

import { pagedFunctions, type ZitadelClient } from "../api-client";
import type { Consent } from "../consent";

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
export class PreviewService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /**
   * List every live preview, across all pages.
   *
   * @returns The previews that are still being served.
   */
  async list(): Promise<readonly ListPreviews200PreviewsItem[]> {
    return this.client.listPreviews.all(this.projectId);
  }

  /**
   * List the live previews a page at a time.
   *
   * @param query - The page size, the cursor to continue from, and `all` to drain every page.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(
    query: Readonly<{ limit?: number; page_token?: string; all?: boolean }> = {},
  ): Promise<{ items: readonly ListPreviews200PreviewsItem[]; next: string | null }> {
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
   * @param consent - The proof the caller was allowed to do something irreversible.
   * @param origin - The preview origin to stop serving.
   */
  async remove(consent: Consent, origin: string): Promise<void> {
    await consent.unlock(this.client).removePreview(this.projectId, {
      origin,
    });
  }
}
