import type { GetMySession200 } from "@zitadel/api/generated/model";
import {
  getApiCsrfToken,
  setApiCsrfRejectionHandler,
  setApiCsrfToken,
} from "@zitadel/api/runtime/auth";
import { ApiError } from "@zitadel/api/runtime/fetch";

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

/**
 * The person this page was loaded for: set by the first session it reads and
 * never changed or cleared for the life of the document. One rule follows from
 * it: a session that belongs to anyone else is never adopted in place, because
 * the page may still show this person's data and forms; the page reloads
 * instead, and the new document starts with whoever is signed in then. Losing
 * the session (sign-out, a 401) does not clear it either: the sign-in widget
 * ends in a full navigation, and the same person signing in again needs no
 * reload.
 */
let pageUserId: string | undefined;

/** Set once the page is reloading: nothing is read or adopted after that. */
let reloading = false;

/**
 * Drops the cached session, the CSRF token, and every read cached for the
 * person (`lib/session-cache.ts`), so the next read goes to the server. This
 * page's person stays: see `pageUserId`.
 */
export function invalidateSessionCache(): void {
  cachedSession = null;
  setApiCsrfToken(undefined);
  clearSessionCaches();
}

/**
 * Reloads the page, once. Returns a promise that never settles, for callers to
 * hand back instead of a session: a caller that got `null` would redirect to
 * /login while the reload is pending.
 */
function startOver(): Promise<never> {
  if (!reloading) {
    reloading = true;
    invalidateSessionCache();
    sessionPage.reload();
  }
  return new Promise<never>(() => undefined);
}

/** Test seam: a fresh document, with no person and no reload pending. */
export function _resetSessionForTesting(): void {
  invalidateSessionCache();
  pageUserId = undefined;
  reloading = false;
}

/**
 * Reads the current session (`GET /sessions/me`).
 *
 * Returns `null` when there is no usable session — missing/expired cookie
 * (401), a non-`active` state, or an anonymous session without a user. Any
 * failure (including network errors) also resolves to `null`: the guard
 * fails closed to the login screen, where a backend outage surfaces as a
 * widget error instead of a half-rendered console. A session that now belongs
 * to someone else never resolves: the page reloads instead.
 */
export async function fetchSession(): Promise<ConsoleSession | null> {
  if (reloading) return startOver();
  if (cachedSession && Date.now() - cachedSession.at < SESSION_CACHE_MS) {
    return cachedSession.session;
  }
  // Every state-changing management call the cookie authenticates must carry
  // the session's CSRF token (ADR 053 §5). The token is stable for the life of
  // a cookie, so it is read only when there is none yet, alongside the session
  // so it costs no extra round trip in sequence. Only the session decides
  // whether someone is signed in, and a failed token read never replaces a
  // token that works.
  const early = getApiCsrfToken() ? undefined : readCsrfToken();
  let session: ConsoleSession;
  try {
    session = await api.getMySession(withCredentials);
  } catch (cause) {
    // The session is gone, and with it the token and the reads cached for it.
    // A transport failure says nothing about the session and keeps them.
    if (cause instanceof ApiError && cause.status === 401) invalidateSessionCache();
    return null;
  }
  if (reloading) return startOver();
  if (session.state !== "active" || !session.user_id) {
    invalidateSessionCache();
    return null;
  }
  if (pageUserId !== undefined && session.user_id !== pageUserId) {
    // Someone else signed in (another tab, or here after a sign-out). Adopting
    // that session would arm this page's open forms to write as them.
    return startOver();
  }
  pageUserId = session.user_id;
  cachedSession = { at: Date.now(), session };
  if (!getApiCsrfToken()) await loadCsrfToken(early);
  return session;
}

/** Reads the token; `undefined` when the read fails. */
function readCsrfToken(): Promise<string | undefined> {
  return api.getMySessionCsrfToken(withCredentials).then(
    (body) => body.csrf_token,
    () => undefined,
  );
}

/**
 * Stores the token for this page's person, keeping the current one when the
 * read failed. Returns the token it stored, if any.
 */
async function loadCsrfToken(pending?: Promise<string | undefined>): Promise<string | undefined> {
  const token = await (pending ?? readCsrfToken());
  if (!token) return undefined;
  // The shared fetch adds it to every unsafe request from here on.
  setApiCsrfToken(token);
  return token;
}

/** Test seam: the full reload `startOver` ends in. */
export const sessionPage = { reload: () => window.location.reload() };

let recheck: Promise<string | undefined> | undefined;

/**
 * Runs when a write was refused with `403 auth.csrf_invalid`: the token was
 * stale (another tab renewed the cookie) or never loaded. The session is read
 * again, with the token alongside it:
 *
 * - still this page's person: their token is stored and returned, and the
 *   shared fetch retries the write once with it;
 * - someone else, or nobody (401): nothing is returned, so the write stays
 *   refused and is never replayed as another person, and the page starts over;
 * - the session read failed for another reason, or this page has no person
 *   yet: nothing is returned and nothing else changes. The write stays refused
 *   for the person to retry; a network blip does not cost them their page.
 */
async function recheckAfterRejection(): Promise<string | undefined> {
  if (pageUserId === undefined || reloading) return undefined;
  const token = readCsrfToken();
  let session: ConsoleSession;
  try {
    session = await api.getMySession(withCredentials);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) void startOver();
    return undefined;
  }
  if (reloading) return undefined;
  if (session.state !== "active" || session.user_id !== pageUserId) {
    void startOver();
    return undefined;
  }
  cachedSession = { at: Date.now(), session };
  return loadCsrfToken(token);
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
