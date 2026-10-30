import type { ListMyPasskeys200PasskeysItem } from "@zitadel/api/generated/model";

import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { formatDateTime } from "./date";
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

/**
 * When the signed-in person's password was set, `null` when they have none,
 * read with the session alone (`GET /users/me/password`).
 */
export async function fetchMyPasswordSetAt(): Promise<string | null> {
  return (await api.getMyPasswordState(consoleSessionProject())).set_at ?? null;
}

/**
 * A password's state as a row reads it: when it was set, not "verified" (an
 * operator may have set it, and no check of it is recorded); `null` is none,
 * `undefined` a read that failed.
 */
export function passwordState(setAt: string | null | undefined): string {
  if (setAt === undefined) return "Could not be loaded";
  return setAt === null ? "Not set" : `Set ${formatDateTime(setAt)}`;
}
