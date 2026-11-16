import type { LocalAdmin } from "./local-admins";
import { adminSessionCookie, consoleSignInUrl, localAdminRequest } from "./local/sign-in";

/**
 * A sign-in as a local server's admin: the console link that signs in once, the
 * session cookie that endpoints which refuse a bearer token need, and the
 * request options a call to that server must carry.
 */
export class AdminSession {
  readonly serverUrl: string;
  readonly admin: LocalAdmin;
  readonly signal: AbortSignal;

  /**
   * @param serverUrl - The local server.
   * @param admin - Whom to sign in as.
   * @param signal - Aborts the requests, as Ctrl-C does for the command that sent them.
   */
  constructor(serverUrl: string, admin: LocalAdmin, signal: AbortSignal) {
    this.serverUrl = serverUrl;
    this.admin = admin;
    this.signal = signal;
  }

  /**
   * A console address that signs the admin in once.
   *
   * @returns The address, with a fresh handoff token.
   */
  consoleUrl(): Promise<string> {
    return consoleSignInUrl(this.serverUrl, this.admin, this.signal);
  }

  /**
   * The session cookie, under the name the server set it with.
   *
   * @returns The cookie, as a `Cookie` header value.
   */
  cookie(): Promise<string> {
    return adminSessionCookie(this.serverUrl, this.admin, this.signal);
  }

  /**
   * The options a request to this server needs: its own origin and a fresh timeout.
   *
   * @param headers - Further headers, such as the cookie.
   * @returns The request options.
   */
  request(headers: Record<string, string> = {}): RequestInit {
    return localAdminRequest(this.serverUrl, headers);
  }
}
