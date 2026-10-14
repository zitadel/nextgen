/**
 * The backend answers every server SDK's tests share, so each SDK is held to
 * the same outage contract: only a 401 or 404 from `GET /sessions/me` ends a
 * session; anything else the backend does (or fails to do) keeps the cookie.
 */

/** `/sessions/me` answers that mean the session is dead. */
export const DEAD: ReadonlyArray<readonly [string, () => Response]> = [
  ["a 401", () => new Response(null, { status: 401 })],
  ["a 404", () => new Response(null, { status: 404 })],
];

/** Backend failures that say nothing about the session. */
export const OUTAGES: ReadonlyArray<readonly [string, () => Promise<Response>]> = [
  ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
  ["a timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
  ["a 500", () => Promise.resolve(new Response(null, { status: 500 }))],
  ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
  ["an unreadable body", () => Promise.resolve(new Response("<html>", { status: 200 }))],
];

/** Proxied calls the backend does not answer, and the status each one gets. */
export const PROXY_FAILURES: ReadonlyArray<
  readonly [string, number, string, () => Promise<Response>]
> = [
  [
    "a network error",
    502,
    "proxy.upstream_unreachable",
    () => Promise.reject(new TypeError("fetch failed")),
  ],
  [
    "a timeout",
    504,
    "proxy.upstream_timeout",
    () => Promise.reject(new DOMException("timed out", "TimeoutError")),
  ],
];
