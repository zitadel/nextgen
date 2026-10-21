---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/components": patch
---

`DELETE /sessions/me` and `GET /sessions/me/csrf` take the same optional
`project_id` as `GET /sessions/me`, and answer a session of another project
with `403 sess.project_mismatch`. A refused sign-out leaves that session signed
in and keeps its cookie. `<zitadel-session>`, `<zitadel-logout>` and the console
send their project when they sign out, and the console also when it reads its
CSRF token. Signing out with `<zitadel-session>` or `<zitadel-logout>` after the
session already ended, in another tab or by expiring, now completes instead of
showing an error.

In `@zitadel/api`, `revokeMySession()` and `getMySessionCsrfToken()` now take
their query parameters first: call `revokeMySession(undefined, init)` and
`getMySessionCsrfToken(undefined, init)` where you passed `init` alone.
