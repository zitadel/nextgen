import { readUserNames } from "@/features/users/api";
import { useAsync } from "@/hooks/use-async";

import type { ProjectEvent } from "./model";

/** The users the rows name: whose account an event concerns, and a person who acted. */
function namedUsers(rows: readonly ProjectEvent[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.user_id) ids.add(row.user_id);
    if (row.actor_id?.startsWith("user_")) ids.add(row.actor_id);
    if (row.event_type === "session.established" && row.payload.user_id) {
      ids.add(row.payload.user_id);
    }
  }
  return [...ids];
}

/**
 * What these users are called, by ID, once their reads land; an empty map
 * before, and for a user without a name. Callers draw the ID until then.
 */
export function useNamesOf(ids: readonly string[]): ReadonlyMap<string, string> {
  const sorted = [...new Set(ids)].sort();
  const key = sorted.join(",");
  return useAsync(sorted.length ? () => readUserNames(sorted) : null, EMPTY, [key]) ?? EMPTY;
}

/** What the users the rows name are called: Events' rows, by ID. */
export function useUserNames(rows: readonly ProjectEvent[]): ReadonlyMap<string, string> {
  return useNamesOf(namedUsers(rows));
}

const EMPTY: ReadonlyMap<string, string> = new Map();
