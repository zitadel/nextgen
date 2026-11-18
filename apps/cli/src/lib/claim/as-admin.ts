import { createZitadelClient } from "@/lib/backend";
import { CSRF_HEADER } from "@/lib/backend/transport";
import { Runtime } from "@/lib/runtime";

/** The team a project was attached to, and when. */
export type ProjectOwner = { team_id: string; claimed_at: string };

/**
 * Attaches a freshly created project to a local server's admin team, through
 * the same endpoints `zitadel claim` and the console use: `claim/init` with the
 * project secret, then `claim/complete` with the admin's session cookie.
 */
export class AdminClaim {
  private readonly serverUrl: string;
  private readonly signal: AbortSignal;
  private readonly sessionCookie: () => Promise<string>;
  private readonly sessionRequest: (headers?: Record<string, string>) => RequestInit;

  /**
   * @param serverUrl - The project's server.
   * @param signal - Cancels the requests.
   * @param sessionCookie - Gives the admin's session cookie on that server.
   * @param sessionRequest - Gives the request options a local admin's call carries, with `headers` added.
   */
  constructor(
    serverUrl: string,
    signal: AbortSignal,
    sessionCookie: () => Promise<string>,
    sessionRequest: (headers?: Record<string, string>) => RequestInit,
  ) {
    this.serverUrl = serverUrl;
    this.signal = signal;
    this.sessionCookie = sessionCookie;
    this.sessionRequest = sessionRequest;
  }

  /**
   * @param project - The project and its secret.
   * @returns The team the project now belongs to.
   */
  async attach(project: { projectId: string; projectSecret: string }): Promise<ProjectOwner> {
    const { projectId, projectSecret } = project;
    const { serverUrl, signal } = this;

    const { challenge_id } = await createZitadelClient({
      userAgent: Runtime.current().userAgent(),
      baseUrl: serverUrl,
      token: projectSecret,
      signal,
    }).createProjectClaim(projectId, this.sessionRequest());

    // claim/complete authenticates by the admin's session cookie, not a bearer
    // token, so this client carries none. As a cookie-authenticated write it
    // also needs the session's CSRF token (ADR 053 §5), which the same cookie
    // reads from GET /sessions/me/csrf.
    const cookie = await this.sessionCookie();
    const client = createZitadelClient({
      userAgent: Runtime.current().userAgent(),
      baseUrl: serverUrl,
      signal,
    });
    const { csrf_token } = await client.getMySessionCsrfToken(
      undefined,
      this.sessionRequest({ cookie }),
    );
    const { team_id, claimed_at } = await client.completeProjectClaim(
      projectId,
      { challenge_id },
      this.sessionRequest({ cookie, [CSRF_HEADER]: csrf_token }),
    );

    return { team_id, claimed_at };
  }
}
