---
"@zitadel/server": patch
---

Fix an authentication bypass: an auth attempt that verified only the identifier
could mint a session. `POST /auth_attempts` created attempts with no required
checks, and an attempt with none was treated as complete the moment the user
identifier resolved, so `POST /auth_attempts/{id}/handoff` and
`POST /sessions/exchange` would issue a session after the identifier alone — no
password, passkey, or SSO. Because the browser-plane publishable key reaches
these endpoints, anyone holding it (it is served at `GET /console/runtime.json`)
could sign in as any user by email.

An attempt now completes only once it carries a verified credential-class factor
(password, passkey, or SSO); the bare user identifier never completes one, even
when no required checks are configured. Handoff and session exchange fail closed
with `att.not_completed`.
