import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { nullOnForbidden } from "@/lib/api-error";
import { readAllPages } from "@/lib/paging";
import type { IdpConnection, UserIdentityLink, Passkey } from "./model";

/**
 * Every connection in the project, newest first: the Identity providers list
 * as shown, and the slugs schemas and flows reference resolved from it. Or
 * `null` when the caller may not read them.
 *
 * `null` is the screen's only signal for `idp.read`: the console has no
 * effective-permissions read, so the refusal itself is the answer (the same
 * reading `fetchUsers` gives a refused expansion). It hides the Identity
 * providers tab and leaves the Sign-in tab on raw slugs. Any other failure is
 * a real error and reaches the route's error boundary.
 */
export function fetchAllIdps(projectId: string): Promise<IdpConnection[] | null> {
  return nullOnForbidden(
    readAllPages(async (pageToken) => {
      // The API sorts ascending by default.
      const page = await api.queryIdps(
        { limit: 100, page_token: pageToken, sorting: { field: "created_at", direction: "desc" } },
        { project_id: projectId },
      );
      return { items: page.idps, next: page.next_page_token };
    }),
  );
}

/** A user's linked provider accounts, oldest first: the order they were linked in. */
export function fetchUserIdentityLinks(userId: string): Promise<UserIdentityLink[]> {
  return readAllPages(async (pageToken) => {
    const page = await api.listUserIdentityLinks(userId, { limit: 100, page_token: pageToken });
    return { items: page.identity_links, next: page.next_page_token };
  });
}

/**
 * The signed-in person's own linked provider accounts, oldest first, read with
 * the session alone (`GET /users/me/identity_links`): no grant needed, so it
 * answers for a platform user who holds none.
 */
export function fetchMyIdentityLinks(): Promise<UserIdentityLink[]> {
  return readAllPages(async (pageToken) => {
    const page = await api.listMyIdentityLinks({
      limit: 100,
      page_token: pageToken,
      ...consoleSessionProject(),
    });
    return { items: page.identity_links, next: page.next_page_token };
  });
}

/**
 * The signed-in person's own passkeys, newest first, read with the session
 * alone (`GET /users/me/passkeys`): no grant needed, so it answers for a
 * platform user who holds none.
 */
export function fetchMyPasskeys(): Promise<Passkey[]> {
  return readAllPages(async (pageToken) => {
    const page = await api.listMyPasskeys({
      limit: 100,
      page_token: pageToken,
      ...consoleSessionProject(),
    });
    return { items: page.passkeys, next: page.next_page_token };
  });
}

/**
 * When the signed-in person's password was set, `null` when they have none,
 * read with the session alone (`GET /users/me/password`).
 */
export async function fetchMyPasswordSetAt(): Promise<string | null> {
  return (await api.getMyPasswordState(consoleSessionProject())).set_at ?? null;
}
