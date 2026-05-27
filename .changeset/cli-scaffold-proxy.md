---
"@zitadel-nextgen/cli": minor
---

`zitadel setup` now scaffolds a `proxy.ts` at the project root that wires up `nextgenMiddleware` from `@zitadel-nextgen/sdk-next`. The proxy forwards `/__nextgen/*` same-origin to `NEXTGEN_ISSUER_URL` (the auth backend) and gates `/profile` behind a JWT check.

Scaffolded pages now use `api-base="/__nextgen"` instead of pointing at the backend URL directly, so no CORS configuration is needed and the backend URL never reaches the browser bundle. `.env.local` no longer writes `NEXT_PUBLIC_ZITADEL_API_BASE`; it writes `NEXTGEN_ISSUER_URL` (the same value, server-side only). `doctor --fix` re-applies `proxy.ts` if missing.
