import { api } from "@/api/zitadel";
import { sessionCached } from "./session-cache";

/**
 * The account the signed-in person works in: their team in the sign-in
 * project — on a platform deployment, the platform project's team that owns
 * customer projects (`docs/design/platform/project-team-modeling.md`).
 *
 * No account resource or current-team field exists, so it is the first team
 * on the person's own roster, from the self-access `GET /users/me/teams`: it
 * needs no grant, which a platform user does not hold. `null` when the person
 * is on no team.
 */
export interface AccountTeam {
  id: string;
  name: string;
}

export const readAccountTeam = sessionCached(async (): Promise<AccountTeam | null> => {
  const team = (await api.listMyTeams({ limit: 1 })).teams[0];
  return team ? { id: team.id, name: team.name } : null;
}, 5 * 60_000);
