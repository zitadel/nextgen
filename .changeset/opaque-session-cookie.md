---
"@zitadel/sdk-next": patch
"@zitadel/sdk-core": patch
---

Validate opaque browser session cookies through `GET /sessions/me` in Next.js middleware instead of treating `__nextgen_session` as a JWT. Explicit Bearer tokens still use JWT/JWKS verification, while cookie-backed server components receive the authenticated user id through tunneled middleware headers.
