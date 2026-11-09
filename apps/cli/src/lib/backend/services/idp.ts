import type { QueryIdps200IdpsItem } from "@zitadel/api/generated/model";

import type { ZitadelClient } from "@/lib/backend/client";
import { ApiService } from "@/lib/backend/api-service";
import { BackendError } from "@/lib/backend/errors";

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

  /**
   * List the slugs of the connections the project already has, so advice that
   * only holds before a connection's first deploy can be left out for them.
   *
   * @remarks
   * Best effort. When the server will not give the listing, such as a token
   * that may not list connections or a server that cannot be reached, the
   * slugs are unknown and the result says so. Anything else, the person
   * stopping the command included, is passed on.
   *
   * @returns The slugs, or undefined when the server would not give them.
   * @throws Whatever else stopped the listing, such as the person stopping
   *   the command.
   */
  async deployedSlugs(): Promise<ReadonlySet<string> | undefined> {
    try {
      const listed = await this.list();
      return new Set(
        listed.map((connection) => {
          return connection.slug;
        }),
      );
    } catch (error) {
      if (error instanceof BackendError) {
        return undefined;
      }
      throw error;
    }
  }
}
