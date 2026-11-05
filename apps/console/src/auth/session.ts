import type { GetMySession200 } from "@zitadel/api/generated/model";
import {
  getApiCsrfToken,
  setApiCsrfRejectionHandler,
  setApiCsrfToken,
} from "@zitadel/api/runtime/auth";
import { ApiError, apiErrorCode } from "@zitadel/api/runtime/fetch";

import { api, apiBase } from "@/api/zitadel";
import { clearSessionCaches } from "@/lib/session-cache";
import { stringParam } from "@/lib/search-params";
import { getConsoleProjectId } from "@/runtime/runtime";

/**
 * Console session helpers (Console ADR 0003).
 *
 * The console authenticates with the HttpOnly session cookie the
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
 * The origin the console's API lives on, which issues the CSRF token: the
 * shared fetch sends the token there and nowhere else (ADR 053 §5). Usually the
 * page's own; `VITE_CONSOLE_API_BASE` may point elsewhere.
 */
const apiOrigin = new URL(apiBase || "/", window.location.href).origin;

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
 * Drops only the cached session, so the next `fetchSession()` reads it again:
 * for a change to the session's own fields (the user ref's `display` after a
 * profile save). The CSRF token and the person's other cached reads stay.
 */
export function refreshSession(): void {
  cachedSession = null;
}

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
 * Reads the cookie's session, held to the project the console signs into once
 * the runtime document names it. The browser sends one host's cookie to every
 * app on it, so on localhost the cookie may hold an app's session: the server
 * refuses it (`403 sess.project_mismatch`), and a server that predates the
 * parameter answers for any project, so the project the answer names is
 * checked too. Either way the result is `null`: no console session.
 */
async function readSession(): Promise<ConsoleSession | null> {
  const projectId = getConsoleProjectId();
  if (!projectId) {
    return api.getMySession(undefined, withCredentials);
  }
  try {
    const session = await api.getMySession({ project_id: projectId }, withCredentials);
    return session.project_id === projectId ? session : null;
  } catch (cause) {
    if (apiErrorCode(cause) === "sess.project_mismatch") return null;
    throw cause;
  }
}

/**
 * The `project_id` the calls on the cookie's session and its user hold that
 * session to: the token read, sign-out, and every `/users/me` call. It is the console's, once the runtime document
 * names it, and the server refuses an app's session there too
 * (`403 sess.project_mismatch`). It is not a management scope: those name the
 * selected project (`lib/project-scope.ts`).
 */
export function consoleSessionProject(): { project_id: string } | undefined {
  const projectId = getConsoleProjectId();
  return projectId ? { project_id: projectId } : undefined;
}

/**
 * Reads the current session (`GET /sessions/me`).
 *
 * Returns `null` when there is no usable session — missing/expired cookie
 * (401), a session of another project, a non-`active` state, or an anonymous
 * session without a user. Any
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
  let session: ConsoleSession | null;
  try {
    session = await readSession();
  } catch (cause) {
    // The session is gone, and with it the token and the reads cached for it.
    // A transport failure says nothing about the session and keeps them.
    if (cause instanceof ApiError && cause.status === 401) invalidateSessionCache();
    return null;
  }
  if (reloading) return startOver();
  if (!session || session.state !== "active" || !session.user_id) {
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
  // Every state-changing management call the cookie authenticates must carry
  // the session's CSRF token (ADR 053 §5). The token is stable for the life of
  // a cookie, so it is read only when there is none yet, and only once the
  // session is known to be active: a signed-out check never asks for one. Only
  // the session decides whether someone is signed in, and a failed token read
  // never replaces a token that works.
  if (!getApiCsrfToken()) await loadCsrfToken();
  return session;
}

/** Reads the token; `undefined` when the read fails, for an app's session too. */
function readCsrfToken(): Promise<string | undefined> {
  return api.getMySessionCsrfToken(consoleSessionProject(), withCredentials).then(
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
  // The shared fetch adds it to every unsafe request to the API from here on.
  setApiCsrfToken(token, apiOrigin);
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
  let session: ConsoleSession | null;
  try {
    session = await readSession();
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) void startOver();
    return undefined;
  }
  if (reloading) return undefined;
  if (!session || session.state !== "active" || session.user_id !== pageUserId) {
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
}, apiOrigin);

/**
 * Revokes the current session (`DELETE /sessions/me`). The server deletes the
 * session and clears the cookie via `Set-Cookie: Max-Age=0`. Errors are
 * swallowed: an already-invalid session is an acceptable sign-out outcome,
 * and the caller navigates to the login screen either way. The revoke names the
 * console's project, so it never ends an app's session the cookie holds.
 *
 * Sign-out is a write, so it carries the CSRF token like any other (ADR 053
 * §5): the caches, token included, are dropped only once the revoke and any
 * retry are done. A refused token's re-check caches the session it reads, and
 * dropping earlier would leave that session for `/login` to bounce back on.
 */
export async function signOut(): Promise<void> {
  try {
    await api.revokeMySession(consoleSessionProject(), withCredentials);
  } catch {
    // Already signed out (401), an app's session (403 sess.project_mismatch)
    // or unreachable — the redirect to /login is the user-visible outcome
    // either way.
  } finally {
    invalidateSessionCache();
  }
}

/**
 * The root router-relative paths resolve against: a placeholder origin, since
 * `next` names a screen of this app, never a host.
 */
const ROUTER_ROOT = "http://console.invalid";

/**
 * Sanitizes a post-login redirect target: `next` as a router-relative path, or
 * `undefined` when it is anything else.
 *
 * The value comes from the page URL, so whoever wrote the link chose it, and
 * the login screen sends the browser there after sign-in: one that left this
 * origin would make the sign-in page an open redirect. So it has to be a path:
 * one `/` not followed by another, since `//evil.example` names another host,
 * and no `\` or control character anywhere, since browsers read `\` as `/` and
 * drop tabs and newlines, which turn `/\evil.example` and `/<tab>/evil.example`
 * into `//evil.example`. What passes is resolved against the router's root,
 * must keep its origin, and must still be a path once `.` and `..` segments
 * collapse, which turns `/.//evil.example` into `//evil.example`. It comes back
 * collapsed, so `..` cannot climb out of the deployment prefix the login screen
 * joins it with.
 */
export function sanitizeNextPath(next: string | undefined): string | undefined {
  if (!next?.startsWith("/") || next.startsWith("//")) return undefined;
  if ([...next].some((char) => char === "\\" || char < " " || char === "\u007f")) {
    return undefined;
  }
  const url = new URL(next, ROUTER_ROOT);
  const path = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === ROUTER_ROOT && !path.startsWith("//") ? path : undefined;
}

/** `validateSearch` for a route whose only search param is a sanitized `next`. */
export function validateNextSearch(search: Record<string, unknown>): { next?: string } {
  return { next: sanitizeNextPath(stringParam(search.next)) };
}
