import { createZitadelClient } from "@/lib/backend";
import { CSRF_HEADER } from "@/lib/backend/transport";
import { Runtime } from "@/lib/runtime";
import type { AdminSession } from "@/lib/server";

/** The team a project was attached to, and when. */
export type ProjectOwner = { team_id: string; claimed_at: string };

/**
 * Attaches a freshly created project to a local server's admin team, through
 * the same endpoints `zitadel claim` and the console use: `claim/init` with the
 * project secret, then `claim/complete` with the admin's session cookie.
 */
export class AdminClaim {
  /**
   * @param input - The project, its secret, and the admin's session on its server.
   * @returns The team the project now belongs to.
   */
  static async attach(input: {
    projectId: string;
    projectSecret: string;
    session: AdminSession;
  }): Promise<ProjectOwner> {
    const { projectId, projectSecret, session } = input;
    const { serverUrl, signal } = session;

    const { challenge_id } = await createZitadelClient({
      userAgent: Runtime.current().userAgent(),
      baseUrl: serverUrl,
      token: projectSecret,
      signal,
    }).createProjectClaim(projectId, session.request());

    // claim/complete authenticates by the admin's session cookie, not a bearer
    // token, so this client carries none. As a cookie-authenticated write it
    // also needs the session's CSRF token (ADR 053 §5), which the same cookie
    // reads from GET /sessions/me/csrf.
    const cookie = await session.cookie();
    const client = createZitadelClient({
      userAgent: Runtime.current().userAgent(),
      baseUrl: serverUrl,
      signal,
    });
    const { csrf_token } = await client.getMySessionCsrfToken(
      undefined,
      session.request({ cookie }),
    );
    const { team_id, claimed_at } = await client.completeProjectClaim(
      projectId,
      { challenge_id },
      session.request({ cookie, [CSRF_HEADER]: csrf_token }),
    );

    return { team_id, claimed_at };
  }
}
