import type { ZitadelClient } from "../api-client";

/**
 * The branding revisions of one project.
 *
 * @remarks
 * A Service Layer (Fowler, Patterns of Enterprise Application Architecture) over the generated API client, which plays the Gateway: a command says what should happen and never which endpoint serves it. Bound to one project at construction, so a call carries only what is specific to it.
 */
export class BrandingService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  /** Every branding revision, newest first as the server orders them. */
  async list() {
    return this.client.listBranding({ project_id: this.projectId });
  }

  /** Read one branding revision. */
  async get(revisionId: string) {
    return this.client.getBrandingById(revisionId);
  }
}
