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
| `@zitadel/sdk-core/middleware` | The middleware layer: `NextgenSession`, `AuthResult`, `NextgenMiddlewareOptions`, route matching (`matchesRoutes`), response-header filtering (`filterResponseHeaders`, `HOP_BY_HOP`), session judgement (`resolveSession`), and the session cookie per project (`sessionCookieName`, `proxySessionCookies`, `serializeSessionCookie`) |

It also exports `resolveZitadelRuntime` / `resolveZitadelRuntimeEnv` and
`ZitadelRuntimeError` for resolving the runtime environment
(`development` / `preview` / `production`).

## How JWT verification works

This is the canonical description of the verification pipeline every SDK
middleware runs (`verifyJwt`):

1. The bearer token from the `Authorization` header is checked first; the
   session cookie is the fallback (see
   [The session cookie](#the-session-cookie)).
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
10. `aud` must name the app's project (`projectId`).

Opaque (non-JWT) session tokens are validated against the backend's
`GET /sessions/me?project_id=…` instead, bounded by `opaqueTokenTimeoutMs`.

A session belongs to one project, while a browser sends the session cookie
to every app on the same host, including the Console of a local server. So a
session counts as signed in only in the app's own project: `projectId`, which
each SDK otherwise reads from `ZITADEL_PROJECT_ID` (then its framework's public
project id variable, as `zitadel setup` writes both). The backend refuses an
opaque session of another project (`403 sess.project_mismatch`), and the SDK
checks the project the answer names as well. A session of another project
reads as signed out and keeps its cookie, since it is live in its own app.
With no project configured, no session counts as signed in.

`resolveSession` is the one implementation of these rules; every server SDK's
middleware calls it.

## The session cookie

The server sets and reads one session cookie, `__nextgen_session`. A browser
shares a host's cookies across every port, so under that name alone the Console
of a local server and every app on `localhost` would keep their sessions in one
slot and sign each other out. An app with a server SDK therefore keeps its
session in a cookie of its own, `sessionCookieName(projectId)`:
`__nextgen_session_<projectId>` (ADR 072).

- **The proxy** (`proxySessionCookies`) renames the server's `Set-Cookie` to the
  app's name on the way to the browser, and on the way to the server sends the
  app's cookie under the server's name. No other session cookie, the
  Console's or another app's, goes up.
- **The middleware** (`resolveSession`) reads the app's cookie, and clears only
  that cookie when it holds a dead session.
- **A session kept under the server's name** before the change, by this app or,
  on `localhost`, by the Console, is read only where the server holds it to the
  app's project: by the middleware, and by the proxy for the session probe
  `GET /sessions/me?project_id=…`. A session that signs a user of this project
  in moves to the app's cookie; any other stays where it is.
- **Without a project**, the proxy passes the cookies through unchanged.

Framework-specific steps (header tunnelling, `auth()` re-verification) are
documented in each framework SDK's README on top of this pipeline.

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with
`export type *`.
