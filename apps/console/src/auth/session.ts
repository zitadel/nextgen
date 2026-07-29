import type { GetMySession200 } from "@zitadel/api/generated/model";

import { api } from "../api/zitadel";

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

/** Drops the cached session (called on sign-out). */
export function invalidateSessionCache(): void {
  cachedSession = null;
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
  try {
    const session = await api.getMySession(withCredentials);
    if (session.state !== "active" || !session.user_id) return null;
    cachedSession = { at: Date.now(), session };
    return session;
  } catch {
    return null;
  }
}

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
