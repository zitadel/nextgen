import type { ListUserIdentityLinks200, QueryUsersBody } from "@zitadel/api/generated/model";
import { Paging } from "@zitadel/api/runtime/paging";

import { ApiService, type Page, type PageOptions } from "@/lib/backend/api-service";
import { pagedFunctions, type ZitadelClient } from "@/lib/backend/client";
import { NotFoundError } from "@/lib/backend/errors";

/** What narrows a query of the project's users: its filters, sorts and page size. */
export type UserQuery = Readonly<QueryUsersBody>;

/** One user, as a query of them answers it. */
export type QueriedUser = Awaited<ReturnType<ZitadelClient["queryUsers"]>>["users"][number];

/** The provider accounts one user signs in with. */
export type IdentityLinks = ListUserIdentityLinks200["identity_links"];

/** A way to sign in that a user holds themselves: a password, a passkey, or a provider account. */
export type Credential = "password" | "passkey" | "sso";

/**
 * The users of the project the client's credential belongs to.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Like the project service it is bound to a client alone, because a
 * credential already names the project whose users it can see, and the query
 * addresses that project when it names none.
 *
 * It offers `page` and no `list`: every caller reads users under a cap of its
 * own rather than draining them, because a project's users are unbounded.
 */
export class UserService extends ApiService {
  /**
   * Read a page of the project's users.
   *
   * @param query - The filters, the page size and the cursor to continue from.
   * @param options - `all` to drain every page instead of reading one.
   * @returns The users read, and the cursor to the next page when one remains.
   */
  async page(query: UserQuery = {}, options: PageOptions = {}): Promise<Page<QueriedUser>> {
    const paging = new Paging(pagedFunctions.queryUsers);
    const pages = this.client.queryUsers.pages(query);
    const collected = await paging.collect(pages, {
      all: options.all === true,
    });
    return {
      items: collected.items,
      next: collected.next,
    };
  }

  /**
   * Whether the project has any users yet.
   *
   * @returns True when at least one user exists.
   */
  async exists(): Promise<boolean> {
    const page = await this.client.queryUsers({
      limit: 1,
    });
    return page.users.length > 0;
  }

  /**
   * Whether a user signs in through a provider account.
   *
   * @remarks
   * A user deleted since they were queried is answered as holding none, not as
   * a failure: the question is asked of a list read a moment earlier, so a name
   * that has since gone is an answer rather than something gone wrong.
   *
   * @param userId - The user to ask about.
   * @returns True when the user holds at least one provider account.
   */
  async hasIdentityLink(userId: string): Promise<boolean> {
    const links = await this.identityLinks(userId).catch((error: unknown): IdentityLinks => {
      if (error instanceof NotFoundError) {
        return [];
      }
      throw error;
    });
    return links.length > 0;
  }

  /**
   * Which of the asked credentials a user holds: a password, a passkey, or a
   * provider account (`sso`).
   *
   * @remarks
   * A user deleted since they were queried holds none, as for
   * {@link hasIdentityLink}.
   *
   * @param userId - The user to ask about.
   * @param asked - The credentials to read; the others are not requested.
   * @returns The asked credentials the user holds.
   */
  async credentials(userId: string, asked: readonly Credential[]): Promise<Set<Credential>> {
    const reads: Record<Credential, () => Promise<boolean>> = {
      password: async () => {
        return (await this.client.getUserPasswordState(userId)).set_at != null;
      },
      passkey: async () => {
        return (await this.client.listUserPasskeys(userId, { limit: 1 })).passkeys.length > 0;
      },
      sso: async () => {
        return (await this.identityLinks(userId)).length > 0;
      },
    };
    const held = new Set<Credential>();
    // One read at a time: a caller asks this of many users at once.
    for (const credential of asked) {
      try {
        if (await reads[credential]()) {
          held.add(credential);
        }
      } catch (error) {
        // Gone mid-read: what was read before belonged to a user who no longer exists.
        if (error instanceof NotFoundError) {
          return new Set();
        }
        throw error;
      }
    }
    return held;
  }

  /**
   * The provider accounts a user signs in with.
   *
   * @param userId - The user to read.
   * @param limit - How many to read, where the caller only counts them.
   * @returns The links the user holds.
   * @throws NotFoundError when the project holds no such user.
   */
  async identityLinks(userId: string, limit = 1): Promise<IdentityLinks> {
    const read = await this.client.listUserIdentityLinks(userId, {
      limit,
    });
    return read.identity_links;
  }
}
