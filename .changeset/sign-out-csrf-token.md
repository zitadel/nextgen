---
"@zitadel/server": minor
"@zitadel/components": minor
---

Signing out with the session cookie (`DELETE /sessions/me`) now needs the
session's CSRF token in `X-Zitadel-CSRF`, like every other write the cookie
authenticates; without it the server answers `403 auth.csrf_invalid` and the
session stays signed in. `<zitadel-session>` and `<zitadel-logout>` read the
token from `GET /sessions/me/csrf` and send it.

**Breaking:** an app on an older `@zitadel/components` cannot sign out against
this server. Update `@zitadel/components` (or the SDK that bundles it) together
with the server. Code that calls `revokeMySession()` itself must first read the
token with `getMySessionCsrfToken()` and send it in the `X-Zitadel-CSRF` header,
or set it once with `setApiCsrfToken()`.
