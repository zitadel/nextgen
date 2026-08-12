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
| `@zitadel/sdk-core` | Everything below in one namespace |
| `@zitadel/sdk-core/types` | The SPA widget contract (`ZitadelFlowStepDetail` and the other widget event/config/handler/props types the SPA SDKs re-export) |
| `@zitadel/sdk-core/jwt` | `verifyJwt`, `decodeJwt`, `isJwtShaped`, `JWKS_TTL_MS` |
| `@zitadel/sdk-core/middleware` | The middleware layer: `NextgenSession`, `AuthResult`, `NextgenMiddlewareOptions`, route matching (`matchesRoutes`), response-header filtering (`filterResponseHeaders`, `HOP_BY_HOP`) |

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
   Crypto API, with a timeout (`jwksTimeoutMs`), and cached per `kid`
   (`JWKS_TTL_MS`).
6. The signature is verified **before** any claim checks.
7. `iss` must be present and equal `url` — tokens without an issuer are
   rejected.
8. `exp` must be present and in the future (with `clockSkewMs` tolerance) —
   tokens without an expiry are rejected.
9. `nbf` and `iat` are validated with `clockSkewMs` tolerance when present.

Opaque (non-JWT) session tokens are validated against the backend's
`GET /sessions/me` instead, bounded by `opaqueTokenTimeoutMs`.

Framework-specific steps (header tunnelling, `auth()` re-verification) are
documented in each framework SDK's README on top of this pipeline.

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with
`export type *`.
