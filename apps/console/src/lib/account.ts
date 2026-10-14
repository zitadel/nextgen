import { useEffect, useState } from "react";

import { api } from "@/api/zitadel";
import { registerSessionCache } from "./session-cache";

/**
 * The account the signed-in person works in: their team in the project the
 * console signs into — the platform project on a deployment that bootstraps one
 * (`docs/design/platform/project-team-modeling.md`: "the account or workspace
 * that owns Projects … is a Team in the platform Project").
 *
 * There is no account resource and no current-team field on the session, so
 * the account is the first team on the person's roster. One is enough: the
 * footer shows the account, it does not switch between several.
 *
 * The roster is read as `POST /users/query` for the person's own id with
 * `expand: ["teams"]`, because `GET /users/{id}/teams` accepts OAuth scopes
 * only and refuses the console session. Read without a project id, so it
 * addresses the sign-in project — the same one `GET /teams/{id}` and
 * `PATCH /teams/{id}` address, which Settings → Account renames it with.
 */
export interface AccountTeam {
  id: string;
  name: string;
}

let cached: { userId: string; value: Promise<AccountTeam | null> } | undefined;
const listeners = new Set<() => void>();
// Dropped with the session, so the next person never reads this one's account.
registerSessionCache({
  clear: () => {
    cached = undefined;
  },
});

/** The account team, or `null` when the person belongs to none. Shared by callers. */
export function readAccountTeam(userId: string): Promise<AccountTeam | null> {
  if (cached?.userId === userId) return cached.value;
  const value = api
    .queryUsers({
      limit: 1,
      filter: [{ field: "id", operation: "equals", value: userId }],
      expand: ["teams"],
    })
    .then((page) => {
      const team = page.users[0]?.teams?.[0];
      return team ? { id: team.id, name: team.name } : null;
    });
  const entry = { userId, value };
  cached = entry;
  // A failure is not kept: the next reader asks again.
  value.catch(() => {
    if (cached === entry) cached = undefined;
  });
  return value;
}

/** Drops the cached answer and re-reads it everywhere it is shown — after a rename. */
export function refreshAccountTeam(): void {
  cached = undefined;
  for (const listener of listeners) listener();
}

/**
 * The account team for the footer: `undefined` while loading, `null` when
 * there is none or the read failed — the footer then shows the person alone,
 * rather than a placeholder account name.
 */
export function useAccountTeam(userId: string | undefined): AccountTeam | null | undefined {
  const [team, setTeam] = useState<AccountTeam | null | undefined>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((current) => current + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setTeam(null);
      return;
    }
    let cancelled = false;
    readAccountTeam(userId)
      .then((value) => {
        if (!cancelled) setTeam(value);
      })
      .catch(() => {
        if (!cancelled) setTeam(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  return team;
}
