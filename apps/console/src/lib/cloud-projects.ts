import { apiForRegion } from "@/api/zitadel";
import type { ConsoleRegion } from "@/runtime/runtime";

/**
 * Creates a project in a region and claims it for the signed-in person
 * (platform mode, Console ADR 0004 §6).
 *
 * Three calls, all to the region, since the home holds no project: the public
 * create, which answers the project secret once; `claim/init` with that
 * secret, which mints the challenge; and `claim/complete` with the session —
 * the region accepts the home's session, and the shared fetch adds the
 * session's CSRF token as it does for every unsafe same-origin call. The
 * secret is used for the challenge and never kept: from here on the project
 * is managed with the session, through the grant the claim created.
 */
export async function createProjectInRegion(
  region: ConsoleRegion,
  name: string,
): Promise<{ id: string; teamId: string }> {
  const regionApi = apiForRegion(region);
  const created = await regionApi.createProject({ name, preview_origins: [], seed_defaults: true });
  const challenge = await regionApi.initClaim(created.id, {
    headers: { authorization: `Bearer ${created.project_secret}` },
  });
  const claimed = await regionApi.completeClaim(created.id, {
    challenge_id: challenge.challenge_id,
  });
  return { id: created.id, teamId: claimed.team_id };
}
