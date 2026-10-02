import type { GetMySession200 } from "@zitadel/api/generated/model";
import { getApiCsrfToken, setApiCsrfRejectionHandler, setApiCsrfToken } from "@zitadel/api/runtime/auth";

import { api } from "../api/zitadel";
import { clearSessionCaches } from "../lib/session-cache";

/**
 * Console session helpers (Console ADR 0003).
 *
 * The console authenticates with the `__nextgen_session` HttpOnly cookie the
 * platform sets after the login widget exchanges its flow `handoff_token`
 * (`POST /sessions/exchange`). These helpers are the only place the console
 * talks to the session endpoints, mirroring the orchestrator's `api-client`
 * convention: every call runs with `credentials: "include"` so the cookie
 * round-trips.
 */

/** The signed-in console session, as returned by `GET /sessions/me`. */
export type ConsoleSession = GetMySession200;

const withCredentials: RequestInit = { credentials: "include" };

/**
 * Short-lived cache of the last confirmed session. The `_authed` guard runs
 * `fetchSession()` on every navigation (and on `intent` preloads), so without
 * a cache every link hover would hit `GET /sessions/me`. Only confirmed
 * sessions are cached — a `null` result is never cached, so a fresh sign-in
 * is picked up immediately. Staleness within the window is acceptable: a
 * revoked session still fails on the next data call, and the 401 boundary
 * redirects to the login screen.
 */
let cachedSession: { at: number; session: ConsoleSession } | null = null;
const SESSION_CACHE_MS = 15_000;

/** Whose session the CSRF token in the shared slot was loaded for. */
let tokenUserId: string | undefined;

/**
 * Drops the cached session (called on sign-out), and with it every read cached
 * for that person (`lib/session-cache.ts`).
 */
export function invalidateSessionCache(): void {
  cachedSession = null;
  tokenUserId = undefined;
  setApiCsrfToken(undefined);
  clearSessionCaches();
}

/**
 * Reads the current session (`GET /sessions/me`).
 *
 * Returns `null` when there is no usable session — missing/expired cookie
 * (401), a non-`active` state, or an anonymous session without a user. Any
 * failure (including network errors) also resolves to `null`: the guard
 * fails closed to the login screen, where a backend outage surfaces as a
 * widget error instead of a half-rendered console.
 */
export async function fetchSession(): Promise<ConsoleSession | null> {
  if (cachedSession && Date.now() - cachedSession.at < SESSION_CACHE_MS) {
    return cachedSession.session;
  }
  // Every state-changing management call the cookie authenticates must carry
  // the session's CSRF token (ADR 053 §5). The token is stable for the life of
  // a cookie, so it is read only when there is none yet (alongside the session,
  // costing no extra round trip in sequence) or when the session turned out to
  // belong to someone else. Only the session decides whether someone is signed
  // in, and a failed token read never replaces a token that works.
  const early = getApiCsrfToken() ? undefined : readCsrfToken();
  try {
    const session = await api.getMySession(withCredentials);
    if (session.state !== "active" || !session.user_id) return null;
    cachedSession = { at: Date.now(), session };
    if (!getApiCsrfToken() || tokenUserId !== session.user_id) {
      await loadCsrfToken(session.user_id, early);
    }
    return session;
  } catch {
    return null;
  }
}

/** Reads the token; `undefined` when the read fails. */
function readCsrfToken(): Promise<string | undefined> {
  return api.getMySessionCsrfToken(withCredentials).then(
    (body) => body.csrf_token,
    () => undefined,
  );
}

/**
 * Stores the token for `userId`, keeping the current one when the read failed.
 * Returns the token it stored, if any.
 */
async function loadCsrfToken(
  userId: string,
  pending?: Promise<string | undefined>,
): Promise<string | undefined> {
  const token = await (pending ?? readCsrfToken());
  if (!token) return undefined;
  // The shared fetch adds it to every unsafe request from here on.
  setApiCsrfToken(token);
  tokenUserId = userId;
  return token;
}

/** Test seam: the full reload a rejection ends in when the person changed. */
export const sessionPage = { reload: () => window.location.reload() };

let recheck: Promise<string | undefined> | undefined;

/**
 * Runs when a write was refused with `403 auth.csrf_invalid`: the token was
 * stale (another tab replaced the cookie by signing in again) or never loaded.
 * The session is read again:
 *
 * - still the person this page shows: their token is loaded and returned, and
 *   the shared fetch retries the write once with it;
 * - someone else, or nobody: nothing is returned, so the write stays refused
 *   and is never replayed as another person. This page belongs to a session
 *   that is gone, so everything cached for it is dropped and it starts over.
 */
async function recheckAfterRejection(): Promise<string | undefined> {
  const shownUserId = tokenUserId ?? cachedSession?.session.user_id;
  cachedSession = null;
  let session: ConsoleSession | null;
  try {
    session = await api.getMySession(withCredentials);
  } catch {
    session = null;
  }
  if (
    !session ||
    session.state !== "active" ||
    !session.user_id ||
    (shownUserId !== undefined && session.user_id !== shownUserId)
  ) {
    invalidateSessionCache();
    sessionPage.reload();
    return undefined;
  }
  cachedSession = { at: Date.now(), session };
  return loadCsrfToken(session.user_id);
}

// Concurrent refusals share one re-check.
setApiCsrfRejectionHandler(() => {
  recheck ??= recheckAfterRejection().finally(() => {
    recheck = undefined;
  });
  return recheck;
});

/**
 * Revokes the current session (`DELETE /sessions/me`). The server deletes the
 * session and clears the cookie via `Set-Cookie: Max-Age=0`. Errors are
 * swallowed: an already-invalid session is an acceptable sign-out outcome,
 * and the caller navigates to the login screen either way.
 */
export async function signOut(): Promise<void> {
  invalidateSessionCache();
  try {
    await api.revokeMySession(withCredentials);
  } catch {
    // Already signed out (401) or unreachable — the redirect to /login is
    // the user-visible outcome either way.
  }
}

/**
 * Sanitizes a post-login redirect target. Only same-app, router-relative
 * paths pass (must start with a single `/`); anything absolute,
 * protocol-relative (`//`), or scheme-carrying is rejected so the `next`
 * search param cannot become an open redirect.
 */
export function sanitizeNextPath(next: string | undefined): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return undefined;
  }
  return next;
}
