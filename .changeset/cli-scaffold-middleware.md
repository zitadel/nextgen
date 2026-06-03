---
"@zitadel-nextgen/cli": minor
---

`zitadel setup` now scaffolds a `middleware.ts` at the project root that wires up `nextgenMiddleware` from `@zitadel-nextgen/sdk-next`. The middleware forwards `/__nextgen/*` same-origin to `NEXTGEN_ISSUER_URL` (the auth backend) and gates `/profile` behind a JWT check.

The file uses the `middleware.ts` + `function middleware()` convention because Next 15 only recognises that form; Next 16 accepts it too (the `proxy.ts` rename is deprecated-but-backwards-compatible). Using the universal form means one template works on every supported Next major.

Scaffolded pages now use `api-base="/__nextgen"` instead of pointing at the backend URL directly, so no CORS configuration is needed and the backend URL never reaches the browser bundle. `.env.local` no longer writes `NEXT_PUBLIC_ZITADEL_API_BASE`; it writes `NEXTGEN_ISSUER_URL` (the same value, server-side only). `doctor --fix` re-applies `middleware.ts` if missing.
