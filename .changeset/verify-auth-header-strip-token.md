---
"@zitadel/sdk-next": minor
"@zitadel/sdk-core": minor
---

Harden the sdk-next auth surface: verify the tunnelled session token, and keep the raw token out of client-side JavaScript.

- **`auth()` now verifies instead of trusts.** Previously it decoded the `x-nextgen-auth-token` header without verification and treated any other non-empty value as a middleware-validated opaque token — on routes outside the middleware `matcher`, a client-supplied header could spoof any identity. `auth()` now re-verifies every value: JWTs cryptographically via JWKS (same rules and defaults as the middleware, in-process key cache), opaque tokens against `GET /sessions/me` (deduplicated per render pass via React `cache()`), failing closed on anything unverified. Opaque sessions also gain the real identity (`userId`/`email`/`name` from the backend) instead of `userId: "unknown"`. New optional `AuthOptions` mirror the middleware's verification options for apps that customise them.
- **`NextgenProvider` strips the session token server-side.** Passing `await auth()` into the provider previously serialised the raw token into the RSC flight payload, readable by any client script. The provider is now a shared component that converts to the client-safe `ClientAuthResult` before the value crosses the server→client boundary, so client components only ever see `userId`/`email`/`name` — matching sdk-nuxt, which already stripped the token from its SSR payload. `useAuth()` returns `ClientAuthResult` accordingly.
- **New `@zitadel/sdk-next/react` entry** for client components (`NextgenProvider`, `useAuth`). The package root is a server-module surface: `auth()` now imports `server-only`, so pulling the root (or `auth()`) into a `"use client"` graph fails the build with an import trace instead of compiling silently. The package also builds as per-file modules now, fixing `"use client"` directives that were previously lost in bundled chunks — the provider/hook entries were unusable from published builds.
- `@zitadel/sdk-core` exports `isJwtShaped()` (JWS vs JWE structural detection), shared by the middleware and `auth()`.
