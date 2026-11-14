import { CSRF_HEADER } from "@/lib/backend/transport";

import { createZitadelClient } from "@/lib/backend";
import type { LocalAdmin } from "./admin-credential";
import { adminSessionCookie, localAdminRequest } from "./sign-in";
import { userAgent } from "@/lib/user-agent";

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
  /** Aborts the requests, as Ctrl-C does for the command that sent them. */
  signal: AbortSignal;
}): Promise<ProjectOwner> {
  const { serverUrl, projectId, projectSecret, admin, signal } = input;

  const { challenge_id } = await createZitadelClient({
    userAgent: userAgent(),
    baseUrl: serverUrl,
    token: projectSecret,
    signal,
  }).createProjectClaim(projectId, localAdminRequest(serverUrl));

  // claim/complete authenticates by the admin's session cookie, not a bearer
  // token, so this client carries none. As a cookie-authenticated write it
  // also needs the session's CSRF token (ADR 053 §5), which the same cookie
  // reads from GET /sessions/me/csrf.
  const cookie = await adminSessionCookie(serverUrl, admin, signal);
  const session = createZitadelClient({ userAgent: userAgent(), baseUrl: serverUrl, signal });
  const { csrf_token } = await session.getMySessionCsrfToken(
    undefined,
    localAdminRequest(serverUrl, { cookie }),
  );
  const { team_id, claimed_at } = await session.completeProjectClaim(
    projectId,
    { challenge_id },
    localAdminRequest(serverUrl, { cookie, [CSRF_HEADER]: csrf_token }),
  );
  return { team_id, claimed_at };
}
