/**
 * The backend answers every server SDK's tests share, so each SDK is held to
 * the same outage contract: only the backend's own `401 auth.unauthorized` or
 * `404 sess.not_found` from `GET /sessions/me` ends a session; anything else
 * the backend (or a gateway in front of it) does, or fails to do, keeps the
 * cookie. It also holds the proxy's shared cases: the exchange answer whose
 * session token must not reach the browser, and the redirects that must stay
 * on the app.
 *
 * This is the canonical copy. Each server SDK keeps a byte-identical copy at
 * `src/__tests__/outages.ts` (sdk-nuxt: `src/__tests__/server/outages.ts`),
 * and its `outages.test.ts` fails when that copy drifts from this one.
 */

/**
 * A session token shaped like the one the backend sets as `__nextgen_session`:
 * a compact JWE (`A256GCMKW` key wrap, `A256GCM` content), five base64url
 * segments. Its header parses, so it goes through the JWT checks (its `alg` is
 * no signing algorithm, so it is not a JWT) before the session check asks the
 * backend about it, as a real cookie does.
 */
export const JWE_SESSION_TOKEN =
  "eyJhbGciOiJBMjU2R0NNS1ciLCJlbmMiOiJBMjU2R0NNIiwiaXYiOiIyQnhqNHZ5NHhGMGc0cDdsIiwia2lkIjoiZW5jX2tleV8wMUpBWjNRN1hLOVYyTTRONlA4UjBUMVczWSIsInRhZyI6IklBNVFUNFF4b0RPRWpIcG9PdjZNR2cifQ" +
  ".D4BoBuS5CSegGrBzqhcKE3ZnQ0Uvq74235YOTqlq49LQa0SBSr0ZAQ" +
  ".aTRihHgeCvJaTD42" +
  ".dxrIiORkU5NVBZykDk9_vW77FgWR7Zn4Y_Tsg-k_r4PB1psboNQWcFKFVDO5oDpk" +
  ".x858dkWgVHAfr1o5HEDeIQ";

/**
 * The backend's answer to the handoff exchange (`POST /sessions/exchange`): the
 * session, the session token in the body, and the same token as the HttpOnly
 * session cookie. The proxy must hand the browser the cookie but not the
 * body's token.
 */
export function exchangeAnswer(): Response {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append(
    "set-cookie",
    `__nextgen_session=${JWE_SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax`,
  );
  return new Response(
    JSON.stringify({
      session: { session_id: "sess_1", user_id: "user_1", state: "active" },
      session_token: JWE_SESSION_TOKEN,
    }),
    { status: 200, headers },
  );
}

/**
 * Upstream `Location` values whose path starts with `//` once resolved, so a
 * proxy that re-parses the path as a reference would send the browser to
 * `evil.example`. Each must stay on the app.
 */
export const OFF_ORIGIN_LOCATIONS: readonly string[] = [
  "https://app.test//evil.example/login?flow=f1",
  "/.//evil.example/login?flow=f1",
  "https://app.test/\\evil.example/login?flow=f1",
  "https://app.test/\\\\evil.example/login?flow=f1",
];

/** `/sessions/me` answers that mean the session is dead. */
export const DEAD: ReadonlyArray<readonly [string, () => Response]> = [
  [
    "a 401 auth.unauthorized",
    () =>
      Response.json(
        { code: "auth.unauthorized", message: "Missing or invalid session token." },
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
  // The code alone decides: an envelope without its message is still the backend's.
  [
    "a 401 auth.unauthorized without a message",
    () => Response.json({ code: "auth.unauthorized" }, { status: 401 }),
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
  // Only the session JSON, which always names its `session_id`, is a session.
  ["a 200 with an empty body", () => Promise.resolve(new Response(null, { status: 200 }))],
  ["a 200 with an empty JSON object", () => Promise.resolve(Response.json({}))],
  [
    "a 200 with JSON that is not a session",
    () => Promise.resolve(Response.json({ user_id: "u1", status: "ok" })),
  ],
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
