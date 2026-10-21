import type { ListMyPasskeys200PasskeysItem } from "@zitadel/api/generated/model";

import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { readAllPages } from "./paging";

/** One registered passkey: its id, name and when it was added, never the credential. */
export type Passkey = ListMyPasskeys200PasskeysItem;

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
