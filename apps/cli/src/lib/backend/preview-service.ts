import { Paging } from "@zitadel/api/runtime/paging";

import { pagedFunctions, type ZitadelClient } from "../api-client";
import type { Consent } from "../consent";

/** What {@link PreviewService.pages} takes beyond the project. */
export type PreviewPageQuery = Readonly<{ limit?: number; page_token?: string; all?: boolean }>;

/** One page of live previews, or every page when it was asked to drain. */
export type PreviewList = Readonly<{
  items: readonly Awaited<ReturnType<ZitadelClient["listPreviews"]>>["previews"][number][];
  /** The cursor to the next page, or null when none remains. */
  next: string | null;
}>;

/**
 * The live previews of one project: the pull-request deployments that expire on
 * their own.
 *
 * @remarks
 * A Service Layer (Fowler, Patterns of Enterprise Application Architecture) over the generated API client, which plays the Gateway: a command says what should happen and never which endpoint serves it. Bound to one project at construction, so a call carries only what is specific to it.
 */
export class PreviewService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /** Every live preview, across all pages. */
  async list() {
    return this.client.listPreviews.all(this.projectId);
  }

  /**
   * The live previews, a page at a time.
   *
   * @param query - The page size, the cursor to continue from, and `all` to drain every page.
   * @returns The items read, and the cursor to the next page when one remains.
   */
  async page(query: PreviewPageQuery = {}): Promise<PreviewList> {
    const { all, ...filter } = query;
    const paging = new Paging(pagedFunctions.listPreviews);
    const pages = this.client.listPreviews.pages(this.projectId, filter);
    const { items, next } = await paging.collect(pages, { all: all === true });
    return Object.freeze({ items, next });
  }

  /** Stop serving one preview origin. */
  async remove(consent: Consent, origin: string): Promise<void> {
    await consent.unlock(this.client).removePreview(this.projectId, { origin });
  }
}
