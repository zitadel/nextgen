import type { ListMyPasskeys200PasskeysItem } from "@zitadel/api/generated/model";

import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { formatDateTime } from "./date";

/** One registered passkey: its id, name and when it was added, never the credential. */
export type Passkey = ListMyPasskeys200PasskeysItem;

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
