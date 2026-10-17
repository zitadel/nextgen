import { HttpResponse } from "msw";

/**
 * Answers to `GET` / `DELETE /sessions/me` for the session widgets' specs.
 *
 * `NO_SESSION` are the backend's own "there is no session" answers, with the
 * envelopes the Go server sends (`internal/api/session.go`, the openapi's
 * `auth-unauthorized` and `sess-not_found` errors). `OUTAGES` are everything
 * else that can come back instead: a gateway, a WAF, an ingress default
 * backend or an SPA host answers these, and none of them says the session is
 * gone, so a widget must treat each one as an error.
 */
export const unauthorized = (): Response =>
  HttpResponse.json(
    { code: "auth.unauthorized", message: "Missing or invalid session token." },
    { status: 401 },
  );

export const sessionNotFound = (): Response =>
  HttpResponse.json(
    { code: "sess.not_found", message: "The session was not found" },
    { status: 404 },
  );

export const NO_SESSION: readonly (readonly [string, () => Response])[] = [
  ["401 auth.unauthorized", unauthorized],
  ["404 sess.not_found", sessionNotFound],
];

const gatewayPage = (status: number) => () =>
  new HttpResponse("<html><body><h1>Not here</h1></body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });

/** Answers that are not the backend speaking about the session. */
export const OUTAGES: readonly (readonly [string, () => Response])[] = [
  ["a gateway's HTML 401", gatewayPage(401)],
  ["a gateway's HTML 404", gatewayPage(404)],
  ["a bodyless 401", () => new HttpResponse(null, { status: 401 })],
  ["a bodyless 404", () => new HttpResponse(null, { status: 404 })],
  [
    "a 404 with another service's code",
    () => HttpResponse.json({ code: "not_found", message: "no route" }, { status: 404 }),
  ],
  [
    "a 403",
    () =>
      HttpResponse.json(
        { code: "auth.csrf_invalid", message: "The request failed CSRF validation." },
        { status: 403 },
      ),
  ],
  ["a 429", () => new HttpResponse("Too Many Requests", { status: 429 })],
  ["a 500", () => new HttpResponse(null, { status: 500 })],
  ["a 503", () => new HttpResponse(null, { status: 503 })],
  ["a network error", () => HttpResponse.error()],
];

/** `GET /sessions/me` 200s whose body is not the session JSON. */
export const UNREADABLE_SESSIONS: readonly (readonly [string, () => Response])[] = [
  [
    "an SPA host's HTML 200",
    () =>
      new HttpResponse("<!doctype html><html><body>app</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  ],
  ["an empty 200", () => new HttpResponse(null, { status: 200 })],
  ["a 200 JSON that is not a session", () => HttpResponse.json({ ok: true })],
];
