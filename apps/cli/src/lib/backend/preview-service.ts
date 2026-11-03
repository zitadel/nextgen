import type { ZitadelClient } from "../api-client";
import type { Consent } from "../consent";

/** What {@link PreviewService.pages} takes beyond the project. */
export type PreviewPageQuery = Readonly<{ limit?: number; page_token?: string }>;

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

  /** The pages of live previews, for a caller that pages through them. */
  pages(query: PreviewPageQuery) {
    return this.client.listPreviews.pages(this.projectId, query);
  }

  /** Stop serving one preview origin. */
  async remove(consent: Consent, origin: string): Promise<void> {
    await consent.unlock(this.client).removePreview(this.projectId, { origin });
  }
}
