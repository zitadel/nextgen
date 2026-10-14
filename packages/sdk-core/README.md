# @zitadel/sdk-core

The shared runtime contract behind the framework SDKs: JWT verification,
middleware primitives, runtime resolution, and the session types every
`@zitadel/sdk-*` package re-exports. Application code usually consumes a
framework SDK (`@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, or one of the SPA
SDKs) instead of this package directly — reach for `sdk-core` when you are
building your own middleware or need the types without a framework wrapper.

## Entry points

| Import | What it carries |
| --- | --- |
| `@zitadel/sdk-core` | The middleware, JWT, and runtime-resolution exports in one namespace. The `/types` widget contract is **not** re-exported from the root — import it from `@zitadel/sdk-core/types` |
| `@zitadel/sdk-core/types` | The SPA widget contract (`ZitadelFlowStepDetail` and the other widget event/config/handler/props types the SPA SDKs re-export) |
| `@zitadel/sdk-core/jwt` | `verifyJwt`, `decodeJwt`, `isJwtShaped`, `JWKS_TTL_MS` |
| `@zitadel/sdk-core/middleware` | The middleware layer: `NextgenSession`, `AuthResult`, the client-safe `ClientSession` / `ClientAuthResult`, `NextgenMiddlewareOptions`, route matching (`matchesRoutes`), response-header filtering (`filterResponseHeaders`, `HOP_BY_HOP`), the exchange-body redaction (`redactExchangeBody`), opaque session checks (`validateOpaqueSessionToken`, `readSessionAnswer`) and the outage responses (`sessionUnavailableResponse`, `proxyFailureResponse`) |

It also exports `resolveZitadelRuntime` / `resolveZitadelRuntimeEnv` and
`ZitadelRuntimeError` for resolving the runtime environment
(`development` / `preview` / `production`).

## How JWT verification works

This is the canonical description of the verification pipeline every SDK
middleware runs (`verifyJwt`):

1. The bearer token from the `Authorization` header is checked first; the
   `__nextgen_session` cookie is the fallback.
2. The JWT header is decoded to extract `kid` and `alg`. A token whose
   segments are not base64url JSON objects, or whose `alg`, `typ` or `kid` is
   not a string, is rejected at once and is never logged: it is attacker
   input. Only a failure on this side (a malformed JWKS key, a Web Crypto
   error) writes to the error log.
3. Tokens with an `alg` not in `allowedAlgorithms` (`RS256`, `ES256` by
   default) are rejected immediately — no JWKS fetch.
4. Tokens with a `typ` not in `allowedTokenTypes` are rejected immediately.
5. The public key is fetched from `{url}/auth/keys` (JWKS) using the Web
   Crypto API, with a timeout (`jwksTimeoutMs`). The issuer's whole JWKS
   document is cached for `JWKS_TTL_MS` (5 minutes); a token naming a `kid`
   the cached document lacks refreshes it, at most once per
   `JWKS_MIN_REFRESH_MS`.
6. The signature is verified **before** any claim checks.
7. `iss` must be present and equal `url` — tokens without an issuer are
   rejected.
8. `exp` must be present and in the future (with `clockSkewMs` tolerance) —
   tokens without an expiry are rejected.
9. `nbf` and `iat` are validated with `clockSkewMs` tolerance when present.

Opaque (non-JWT) session tokens are validated against the backend's
`GET /sessions/me` instead, bounded by `opaqueTokenTimeoutMs`. Only the
backend's own answer that the session is gone, a `401` with the code
`auth.unauthorized` or a `404` with `sess.not_found`, means the session is dead
and its cookie is cleared. A token that cannot be one the backend minted
(anything but base64url characters and dots, or longer than
`MAX_SESSION_TOKEN_LENGTH`) is dead too, without asking the backend
(`isWellFormedSessionToken`). Anything else (a network error, a timeout, a
`5xx`, an unreadable body, a `200` that is not the session JSON with its
`session_id`, or a `401`/`404` page from a gateway in front of the backend)
leaves the outcome unknown: every SDK keeps the cookie, treats the request as
signed out for now with `reason: "unavailable"` on its auth result, and answers
a protected route with a retryable `503` instead of the login redirect.

Only a failure to reach the backend (a network error, a timeout, or a `502`,
`503` or `504`) starts a backoff: it is logged once, and the backend is not
asked again for `SESSION_CHECK_BACKOFF_MS` (15 seconds, longer than the
default timeout). A slow answer that arrives within `opaqueTokenTimeoutMs` is
an answer: every request waits for its own, so a backend that is slow but
healthy (a cold start, a busy database) never makes a signed-in user's session
unavailable, and a hanging backend costs only the requests that arrive before
the first check times out. A protected route's `503` carries `retry-after`
with the seconds left in the backoff (5 when none is running), so a client
that honours it does not retry into the window.
Any other unknown answer (a `500`, say) may come from the request's own token,
so it holds for that request only; it is logged at most once per
`SESSION_CHECK_BACKOFF_MS`.

A JWT whose keys cannot be had (the JWKS endpoint fails and no keys are
cached) is unknown in the same way: `checkJwt` answers `unavailable`, and every
SDK keeps the cookie and answers a protected route `503`. A JWKS refresh that
fails with keys cached keeps verifying against them; either way the failure is
logged once and the JWKS is not fetched again for `JWKS_FAILURE_BACKOFF_MS`
(5 seconds).

The backoff and the JWKS cache are module state, so they
are per process or isolate: each serverless instance, edge isolate or worker
keeps its own, and an instance that serves one request at a time gains only
across the requests it serves in sequence. In Next.js the edge middleware and
the Node `auth()` load separate copies of this package, each with its own
backoff and JWKS cache, so `auth()` can report `unavailable` for a request the
middleware just saw live.

Anything a server hands to the browser (load data, a server function's result,
an SSR payload) must not carry the session token, which the backend sets as an
HttpOnly cookie. `toClientAuth(auth)` turns an `AuthResult` into the
`ClientAuthResult` without it; each server SDK wraps it as `getClientAuth`.
The handoff exchange (`POST /sessions/exchange`) answers with the session token
in its body as well as in the cookie, so every SDK proxy relays that answer
through `redactExchangeBody`, which drops the token and keeps the rest.

A proxied `/__nextgen/*` call the backend does not answer comes back as a `502`
(unreachable) or `504` (`proxyTimeoutMs` elapsed) with an `{ code, message }`
body, the same in every SDK.

Framework-specific steps (header tunnelling, `auth()` re-verification) are
documented in each framework SDK's README on top of this pipeline.

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with
`export type *`.
