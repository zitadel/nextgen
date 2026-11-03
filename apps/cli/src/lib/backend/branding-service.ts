import type { ZitadelClient } from "../api-client";

/** The branding revisions of one project. */
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
