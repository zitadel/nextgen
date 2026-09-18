import { isObject } from "../json";
import type { LocalAdmin } from "./admin-credential";
import { apiError, fetchJson, postJson } from "./http";
import { adminSessionCookie } from "./sign-in";

/** What the platform records about the team a project belongs to. */
export type ProjectOwner = {
  team_id: string;
  /**
   * Absent when the project was already claimed: the 409 names the owning team
   * but not when it happened, and a local timestamp would disagree with the
   * grant this record mirrors.
   */
  claimed_at?: string;
};

/**
 * Attaches a freshly created project to the local admin's team, through the
 * same endpoints `zitadel claim` and the console use: `claim/init` with the
 * project secret, then `claim/complete` with the admin's session cookie.
 */
export async function claimProjectAsAdmin(input: {
  serverUrl: string;
  projectId: string;
  projectSecret: string;
  admin: LocalAdmin;
}): Promise<ProjectOwner> {
  const { serverUrl, projectId, projectSecret, admin } = input;
  const origin = new URL(serverUrl).origin;
  const project = encodeURIComponent(projectId);

  const init = await fetchJson(
    `${serverUrl}/projects/${project}/claim/init?project_id=${project}`,
    { method: "POST", headers: { authorization: `Bearer ${projectSecret}`, origin } },
  );

  const owner = alreadyClaimedBy(init.status, init.body);
  if (owner) return owner;

  if (!init.ok || !isObject(init.body) || typeof init.body.challenge_id !== "string") {
    throw apiError("claim/init", init);
  }

  const complete = await postJson(
    `${serverUrl}/projects/${project}/claim/complete?project_id=${project}`,
    { challenge_id: init.body.challenge_id },
    { cookie: await adminSessionCookie(serverUrl, admin), origin },
  );
  if (
    !complete.ok ||
    !isObject(complete.body) ||
    typeof complete.body.team_id !== "string" ||
    typeof complete.body.claimed_at !== "string"
  ) {
    throw apiError("claim/complete", complete);
  }
  return { team_id: complete.body.team_id, claimed_at: complete.body.claimed_at };
}

/** A 409 from `claim/init` names the team that already owns the project. */
function alreadyClaimedBy(status: number, body: unknown): ProjectOwner | undefined {
  if (status !== 409 || !isObject(body) || !isObject(body.details)) return undefined;
  const teamId = body.details.team_id;
  return typeof teamId === "string" ? { team_id: teamId } : undefined;
}
