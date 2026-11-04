import type { ZitadelClient } from "../api-client";

/**
 * The users of the project the client's credential belongs to.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Like the project service it is bound to a client alone, because a
 * credential already names the project whose users it can see.
 */
export class UserService {
  private readonly client: ZitadelClient;

  constructor(client: ZitadelClient) {
    this.client = client;
  }

  /**
   * Whether the project has any users yet.
   *
   * @param options - A signal that aborts the read.
   * @returns True when at least one user exists.
   */
  async exists(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<boolean> {
    const page = await this.client.queryUsers({ limit: 1 }, undefined, {
      signal: options.signal,
    });
    return page.users.length > 0;
  }
}
