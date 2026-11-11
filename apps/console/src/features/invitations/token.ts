/**
 * The invitation link's token, between the link and the calls that spend it
 * (root ADR 086 §3, §10).
 *
 * The link is `{console}/invitations/accept#token=…`. A fragment is never sent
 * to a server, but it sits in the address bar, where a script that reports the
 * page's URL would read it. So the token moves into `sessionStorage` and the
 * fragment is dropped before anything else on the page runs
 * (`capture-token.ts`, the entry's first import), and every later step reads it
 * from there. It never goes into a query string, which is why the invitation
 * page checks the session itself rather than sitting under the `_authed` guard:
 * `?next=` carries only the path.
 *
 * `sessionStorage` lasts for the tab, across the sign-in round trip, which is a
 * full navigation. It is cleared when the invitation is finished (accepted,
 * declined, unknown) and on sign-out; reopening the link stores it again, which
 * is how an interrupted acceptance resumes.
 */
const STORAGE_KEY = "zitadel.console.invitation_token";

/** The router-relative path of the invitation page. */
export const INVITATION_ACCEPT_PATH = "/invitations/accept";

/**
 * Moves the token from the fragment into storage and drops the fragment, on
 * the invitation page only. Anything else in the URL stays. Says whether there
 * was a token to move.
 */
export function captureInvitationToken(
  location: Pick<Location, "pathname" | "search" | "hash"> = window.location,
  history: Pick<History, "replaceState" | "state"> = window.history,
): boolean {
  if (!location.pathname.replace(/\/$/, "").endsWith(INVITATION_ACCEPT_PATH)) return false;
  const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  if (!token) return false;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // No storage (blocked, or full): the page has no token and says the link
    // is unavailable. The fragment is still dropped.
  }
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  return true;
}

/** The stored token, if a link left one. */
export function readInvitationToken(): string | undefined {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Forgets the token: the invitation is finished, or the person signed out. */
export function clearInvitationToken(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was stored where nothing can be.
  }
}
