import { api } from "@/api/zitadel";
import { fetchSession } from "@/auth/session";
import { sessionCached } from "./session-cache";

/**
 * The account the signed-in person works in: their team in the sign-in
 * project — on a platform deployment, the platform project's team that owns
 * customer projects (`docs/design/platform/project-team-modeling.md`).
 *
 * No account resource or current-team field exists, so it is the first team
 * on the person's roster, read through `POST /users/query` with
 * `expand: ["teams"]` (`GET /users/{id}/teams` refuses a session). Without a
 * project id, so it addresses the same project `PATCH /teams/{id}` renames it
 * in. `null` when the person is on no team.
 */
export interface AccountTeam {
  id: string;
  name: string;
}

export const readAccountTeam = sessionCached(async (): Promise<AccountTeam | null> => {
  const userId = (await fetchSession())?.user_id;
  if (!userId) return null;
  const page = await api.queryUsers({
    limit: 1,
    filter: [{ field: "id", operation: "equals", value: userId }],
    expand: ["teams"],
  });
  const team = page.users[0]?.teams?.[0];
  return team ? { id: team.id, name: team.name } : null;
}, 5 * 60_000);
