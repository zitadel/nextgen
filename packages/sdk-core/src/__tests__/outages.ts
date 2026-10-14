/**
 * The backend answers every server SDK's tests share, so each SDK is held to
 * the same outage contract: only the backend's own `401 auth.unauthorized` or
 * `404 sess.not_found` from `GET /sessions/me` ends a session; anything else
 * the backend (or a gateway in front of it) does, or fails to do, keeps the
 * cookie.
 *
 * This is the canonical copy. Each server SDK keeps a byte-identical copy at
 * `src/__tests__/outages.ts` (sdk-nuxt: `src/__tests__/server/outages.ts`),
 * and its `outages.test.ts` fails when that copy drifts from this one.
 */

/** `/sessions/me` answers that mean the session is dead. */
export const DEAD: ReadonlyArray<readonly [string, () => Response]> = [
  [
    "a 401 auth.unauthorized",
    () =>
      Response.json(
        { code: "auth.unauthorized", message: "The request lacks valid authentication." },
        { status: 401 },
      ),
  ],
  [
    "a 404 sess.not_found",
    () =>
      Response.json(
        { code: "sess.not_found", message: "The session was not found" },
        { status: 404 },
      ),
  ],
];

/** An HTML error page, as a gateway or ingress in front of the backend serves it. */
function gatewayPage(status: number): Promise<Response> {
  return Promise.resolve(
    new Response("<html><body>Not here</body></html>", {
      status,
      headers: { "content-type": "text/html" },
    }),
  );
}

/** Backend failures that say nothing about the session. */
export const OUTAGES: ReadonlyArray<readonly [string, () => Promise<Response>]> = [
  ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
  ["a timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
  ["a 500", () => Promise.resolve(new Response(null, { status: 500 }))],
  ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
  ["an unreadable body", () => Promise.resolve(new Response("<html>", { status: 200 }))],
  ["a 401-gateway-html page", () => gatewayPage(401)],
  ["a 404-gateway-html page", () => gatewayPage(404)],
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
