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
| `@zitadel/sdk-core/middleware` | The middleware layer: `NextgenSession`, `AuthResult`, the client-safe `ClientSession` / `ClientAuthResult`, `NextgenMiddlewareOptions`, route matching (`matchesRoutes`), response-header filtering (`filterResponseHeaders`, `HOP_BY_HOP`), opaque session checks (`validateOpaqueSessionToken`) and the outage responses (`sessionUnavailableResponse`, `proxyFailureResponse`) |

It also exports `resolveZitadelRuntime` / `resolveZitadelRuntimeEnv` and
`ZitadelRuntimeError` for resolving the runtime environment
(`development` / `preview` / `production`).

## How JWT verification works

This is the canonical description of the verification pipeline every SDK
middleware runs (`verifyJwt`):

1. The bearer token from the `Authorization` header is checked first; the
   `__nextgen_session` cookie is the fallback.
2. The JWT header is decoded to extract `kid` and `alg`.
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
and its cookie is cleared. Anything else (a network error, a timeout, a `5xx`,
an unreadable body, or a `401`/`404` page from a gateway in front of the
backend) leaves the outcome unknown: every SDK keeps the cookie, treats the
request as signed out for now with `reason: "unavailable"` on its auth result,
and answers a protected route with a retryable `503` instead of the login
redirect. An unknown outcome is logged once and the backend is not asked again
for `SESSION_CHECK_BACKOFF_MS` (5 seconds), so a hanging backend does not cost
every request the full timeout. A JWKS refresh that fails (including a `5xx`)
keeps verifying against the keys already cached, is logged once, and is not
retried for `JWKS_FAILURE_BACKOFF_MS` (5 seconds).

A proxied `/__nextgen/*` call the backend does not answer comes back as a `502`
(unreachable) or `504` (`proxyTimeoutMs` elapsed) with an `{ code, message }`
body, the same in every SDK.

Framework-specific steps (header tunnelling, `auth()` re-verification) are
documented in each framework SDK's README on top of this pipeline.

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with
`export type *`.
