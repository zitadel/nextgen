import { useAsync } from "@/hooks/use-async";

import { readUserNames } from "./api";
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
  return [...ids].sort();
}

/**
 * What the users the rows name are called, by ID, once their reads land; an
 * empty map before, and for a user without a name. Rows draw the ID until then.
 */
export function useUserNames(rows: readonly ProjectEvent[]): ReadonlyMap<string, string> {
  const ids = namedUsers(rows);
  const key = ids.join(",");
  return (
    useAsync(ids.length ? () => readUserNames(ids) : null, new Map<string, string>(), [key]) ??
    EMPTY
  );
}

const EMPTY: ReadonlyMap<string, string> = new Map();
