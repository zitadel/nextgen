import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { sessionCached } from "./session-cache";

/**
 * The account the signed-in person works in: the first team on their own
 * roster (`GET /users/me/teams`, no grant needed), `null` when they are on
 * none. See `docs/design/platform/project-team-modeling.md`.
 */
export interface AccountTeam {
  id: string;
  name: string;
}

export const readAccountTeam = sessionCached(async (): Promise<AccountTeam | null> => {
  const team = (await api.listMyTeams({ limit: 1, ...consoleSessionProject() })).teams[0];
  return team ? { id: team.id, name: team.name } : null;
}, 5 * 60_000);
