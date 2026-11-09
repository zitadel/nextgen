import type { QueryIdps200IdpsItem } from "@zitadel/api/generated/model";

import type { ZitadelClient } from "@/lib/backend/client";
import { ApiService } from "@/lib/backend/api-service";

/** An identity-provider connection, at its newest revision, as the list of them returns it. */
export type IdpSummary = QueryIdps200IdpsItem;

/**
 * The identity-provider connections of one project: listing them.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 *
 * A release creates and revises the connections, so nothing here writes one.
 */
export class IdpService extends ApiService {
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
   * List the connections, across all pages.
   *
   * @returns Every connection the project has, each at its newest revision.
   */
  async list(): Promise<readonly IdpSummary[]> {
    return this.client.queryIdps.all(
      {},
      {
        project_id: this.projectId,
      },
    );
  }
}
