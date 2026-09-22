import { createZitadelClient } from "@zitadel/api/client";

import type { LocalAdmin } from "./admin-credential";
import { adminSessionCookie, localAdminRequest } from "./sign-in";

/** The team a project was attached to, and when. */
export type ProjectOwner = { team_id: string; claimed_at: string };

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

  const { challenge_id } = await createZitadelClient({
    baseUrl: serverUrl,
    token: projectSecret,
  }).initClaim(projectId, localAdminRequest(serverUrl));

  // claim/complete authenticates by the admin's session cookie, not a bearer
  // token, so this client carries none.
  const cookie = await adminSessionCookie(serverUrl, admin);
  const { team_id, claimed_at } = await createZitadelClient({ baseUrl: serverUrl }).completeClaim(
    projectId,
    { challenge_id },
    localAdminRequest(serverUrl, { cookie }),
  );
  return { team_id, claimed_at };
}
